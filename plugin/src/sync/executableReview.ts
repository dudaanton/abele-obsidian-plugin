import { z } from 'zod'
import { sha256 } from '@abele/sync-core'
import {
  configurationPath,
  executablePath,
  reviewedSelection,
  type ExecutablePaths,
} from './stagedPluginCode'
import {
  ReviewDocuments,
  reviewId,
  reviewPath,
  reviewSourceSchema,
  reviewTime,
  rootConnection,
  sourceIdentity,
  type ReviewSource,
  type ReviewState,
} from './reviewState'

export const EXECUTABLE_REVIEW_KEY = 'token-executable-review-v1'
const operation = z.enum([
  'create',
  'modify',
  'move',
  'delete',
  'removal',
  'mkdir',
  'move_directory',
  'delete_directory',
])
const candidateSchema = z
  .object({
    id: reviewId,
    source: reviewSourceSchema,
    fileId: reviewId,
    versionId: reviewId,
    path: reviewPath,
    previousPath: reviewPath.nullable(),
    operation,
    directory: z.boolean(),
    receivedAt: reviewTime,
    mtime: reviewTime,
    kind: z.enum(['note', 'canvas', 'script', 'settings', 'attachment', 'directory']).optional(),
    sha: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    bytes: z.array(z.number().int().min(0).max(255)).nullable(),
    status: z.enum(['pending', 'applying', 'approved', 'declined']),
  })
  .strict()
const schema = z
  .object({ version: z.literal(1), candidates: z.array(candidateSchema) })
  .strict()
  .refine(
    (doc) =>
      new Set(doc.candidates.map((one) => one.id)).size === doc.candidates.length &&
      new Set(doc.candidates.map(deliveryIdentity)).size === doc.candidates.length,
    'Ambiguous executable review identities'
  )
export type ExecutableCandidate = z.infer<typeof candidateSchema>
export interface IncomingExecutable {
  source: ReviewSource
  fileId: string
  versionId: string
  path: string
  previousPath: string | null
  operation: z.infer<typeof operation>
  directory: boolean
  receivedAt: number
  mtime: number
  sha: string | null
  bytes: Uint8Array | null
  kind?: 'note' | 'canvas' | 'script' | 'settings' | 'attachment' | 'directory'
}
export interface ExecutableApplyPort {
  /** No network: coordinate paths + baseline, recheck local edits, and apply idempotently by candidate.id. */
  apply(candidate: ExecutableCandidate): Promise<void>
}
const initial = { version: 1 as const, candidates: [] as ExecutableCandidate[] }
const pending = (one: ExecutableCandidate) => one.status === 'pending' || one.status === 'applying'
const deliveryIdentity = (one: ExecutableCandidate) =>
  JSON.stringify([
    sourceIdentity(one.source),
    one.fileId,
    one.versionId,
    one.operation,
    one.path,
    one.previousPath,
  ])

/** Durable immutable staging, with the retained exact-review lane semantics and no UI. */
export class ExecutableReview {
  updatePaths(paths: ExecutablePaths): void {
    Object.assign(this.paths, paths)
  }
  private readonly documents: ReviewDocuments
  constructor(
    store: ReviewState,
    private readonly paths: ExecutablePaths = {}
  ) {
    this.documents = new ReviewDocuments(store)
  }
  /** The engine uses the same rule for outgoing scans and both incoming move endpoints. */
  allowsPath(source: ReviewSource, path: string): boolean {
    reviewSourceSchema.parse(source)
    reviewPath.parse(path)
    return rootConnection(source) || !configurationPath(path, this.paths)
  }
  private async integrity(one: ExecutableCandidate): Promise<void> {
    const noContent = one.directory || one.operation === 'delete' || one.operation === 'removal'
    if (
      noContent
        ? one.bytes !== null || one.sha !== null
        : one.bytes === null ||
          one.sha === null ||
          (await sha256(Uint8Array.from(one.bytes))) !== one.sha
    )
      throw new Error('Executable candidate integrity requires recovery')
  }
  async stage(
    input: IncomingExecutable
  ): Promise<{ disposition: 'ordinary' | 'excluded' | 'staged'; candidate?: ExecutableCandidate }> {
    const one = candidateSchema.parse({
      ...input,
      id: crypto.randomUUID(),
      source: structuredClone(input.source),
      bytes: input.bytes === null ? null : Array.from(input.bytes),
      status: 'pending',
    })
    const paths = [one.path, one.previousPath].filter((path): path is string => path !== null)
    if (paths.some((path) => !this.allowsPath(one.source, path))) return { disposition: 'excluded' }
    if (
      one.kind !== 'script' &&
      !paths.some((path) => executablePath(path, one.directory, this.paths))
    )
      return { disposition: 'ordinary' }
    await this.integrity(one)
    const candidate = await this.documents.update(EXECUTABLE_REVIEW_KEY, schema, initial, (doc) => {
      if (
        doc.candidates.some(
          (prior) =>
            prior.source.id === one.source.id &&
            sourceIdentity(prior.source) !== sourceIdentity(one.source)
        )
      )
        throw new Error('Executable source binding changed')
      const prior = doc.candidates.find(
        (prior) => deliveryIdentity(prior) === deliveryIdentity(one)
      )
      if (prior) {
        if (
          prior.sha !== one.sha ||
          prior.mtime !== one.mtime ||
          prior.directory !== one.directory ||
          prior.kind !== one.kind ||
          JSON.stringify(prior.bytes) !== JSON.stringify(one.bytes)
        )
          throw new Error('Immutable executable delivery changed')
        return prior
      }
      doc.candidates.push(one)
      return one
    })
    return { disposition: 'staged', candidate }
  }
  async pending(): Promise<ExecutableCandidate[]> {
    const doc = await this.documents.read(EXECUTABLE_REVIEW_KEY, schema, initial)
    const candidates = doc.candidates.filter(pending)
    for (const one of candidates) await this.integrity(one)
    return candidates
  }
  async state(): Promise<ExecutableCandidate[]> {
    return (await this.documents.read(EXECUTABLE_REVIEW_KEY, schema, initial)).candidates
  }
  async heldPaths(connectionId: string): Promise<string[]> {
    return [
      ...new Set(
        (await this.pending())
          .filter((one) => one.source.id === connectionId)
          .flatMap((one) =>
            [one.path, one.previousPath].filter((path): path is string => path !== null)
          )
      ),
    ]
  }
  async approve(ids: readonly string[], port: ExecutableApplyPort): Promise<void> {
    const shown = reviewedSelection(await this.pending(), ids, (one) => one.id)
    for (const candidate of shown) {
      const release = this.documents.claim(candidate.id)
      try {
        const chosen = await this.documents.update(
          EXECUTABLE_REVIEW_KEY,
          schema,
          initial,
          (doc) => {
            const one = doc.candidates.find((one) => one.id === candidate.id)
            if (!one || !pending(one)) return null
            one.status = 'applying'
            return one
          }
        )
        if (!chosen) continue
        await this.integrity(chosen)
        await port.apply(structuredClone(chosen))
        await this.documents.update(EXECUTABLE_REVIEW_KEY, schema, initial, (doc): null => {
          const one = doc.candidates.find((one) => one.id === candidate.id)
          if (!one || one.status !== 'applying')
            throw new Error('Executable apply state requires recovery')
          one.status = 'approved'
          return null
        })
      } finally {
        release()
      }
    }
  }
  async reject(ids: readonly string[]): Promise<void> {
    await this.documents.update(EXECUTABLE_REVIEW_KEY, schema, initial, (doc): null => {
      for (const one of reviewedSelection(
        doc.candidates,
        ids,
        (one) => one.id,
        (one) => one.status === 'pending'
      ))
        one.status = 'declined'
      return null
    })
  }
}
