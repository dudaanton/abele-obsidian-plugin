import { z } from 'zod'
import type { StateStore } from '@abele/sync-sdk/core'
import { validatePath, serverUrlProblem } from '@abele/sync-sdk/protocol'
import type { TokenConnectionRecord } from './tokenConnectionRegistry'

export type ReviewState = Pick<StateStore, 'getMeta' | 'setMeta' | 'transaction'>
const QUEUE = Symbol.for('abele.sync.review-state-v1')
interface Queue {
  tail: Promise<unknown>
  applying: Set<string>
}
function queueOf(store: ReviewState): Queue {
  const host = store as ReviewState & { [QUEUE]?: Queue }
  return (host[QUEUE] ??= { tail: Promise.resolve(), applying: new Set() })
}
export const reviewId = z.string().min(1).max(200)
export const reviewTime = z.number().int().nonnegative()
export const reviewPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => {
    // Host configuration roots may differ from the wire default. Keep canonical
    // segment checks while allowing a dot-prefixed first configuration segment.
    const parts = value.split('/')
    if (parts[0].startsWith('.') && parts[0] !== '.' && parts[0] !== '..')
      parts[0] = '_' + parts[0].slice(1)
    try {
      validatePath(parts.join('/'))
      return value === value.normalize('NFC')
    } catch {
      return false
    }
  })
/** The host preserves physical spelling; only the request path must be canonical NFC. */
export const localReviewPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => reviewPath.safeParse(value.normalize('NFC')).success)
export const reviewSourceSchema = z
  .object({
    id: reviewId,
    address: z.string().refine((value) => serverUrlProblem(value) === null),
    spaceId: reviewId,
    tokenId: reviewId,
    scope: z
      .object({
        kind: z.enum(['folder', 'group', 'file']),
        id: reviewId,
        path: z.string().min(1).max(1024),
      })
      .strict(),
  })
  .strict()
export type ReviewSource = z.infer<typeof reviewSourceSchema>
/** Strip credentials, references and ledger state from the UI/source snapshot. */
export function reviewSourceOf(record: TokenConnectionRecord): ReviewSource {
  return reviewSourceSchema.parse({
    id: record.id,
    address: record.address,
    spaceId: record.spaceId,
    tokenId: record.tokenId,
    scope: record.scope,
  })
}
export const sourceIdentity = (source: ReviewSource): string =>
  JSON.stringify([
    source.id,
    source.address,
    source.spaceId,
    source.tokenId,
    source.scope.kind,
    source.scope.id,
  ])
/** Path is an authoritative selector hint, never an account or role distinction. */
export const rootConnection = (source: ReviewSource): boolean =>
  source.scope.kind === 'folder' && source.scope.path === '/'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Dedicated device metadata writer; never share an engine's uncommitted overlay. */
export class ReviewDocuments {
  constructor(private readonly store: ReviewState) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const queue = queueOf(this.store),
      next = queue.tail.then(work)
    queue.tail = next.catch(() => {})
    return next
  }
  private async load<T>(key: string, schema: z.ZodType<T>, initial: T): Promise<T> {
    const raw = await this.store.getMeta(key)
    return raw === null ? clone(initial) : schema.parse(JSON.parse(raw))
  }
  read<T>(key: string, schema: z.ZodType<T>, initial: T): Promise<T> {
    return this.serial(() => this.load(key, schema, initial))
  }
  update<T, R>(
    key: string,
    schema: z.ZodType<T>,
    initial: T,
    work: (doc: T) => R | Promise<R>
  ): Promise<R> {
    return this.serial(async () => {
      let encoded = ''
      const result = await this.store.transaction(async () => {
        const doc = await this.load(key, schema, initial),
          result = await work(doc)
        encoded = JSON.stringify(schema.parse(doc))
        await this.store.setMeta(key, encoded)
        return result
      })
      if ((await this.store.getMeta(key)) !== encoded)
        throw new Error('Review storage requires recovery')
      return result === undefined ? result : clone(result)
    })
  }
  claim(id: string): () => void {
    const queue = queueOf(this.store)
    if (queue.applying.has(id)) throw new Error('Candidate approval is already running')
    queue.applying.add(id)
    return () => {
      queue.applying.delete(id)
    }
  }
}
