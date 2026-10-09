import { caseKey } from '@abele/sync-protocol'
import { ExternalFilePortError } from './filesystem'
import { OwnedArtifactSchema } from './records'

/** Supplied by the engine's exclusive queue, not by its public sync() verb.
 * Publication, when needed, runs outside this queue and is revalidated on re-entry. */
export interface ExternalSerialization {
  run<T>(work: () => Promise<T>): Promise<T>
}
export interface ExternalReservationRequest {
  operationId: string
  fileId: string
  paths: readonly string[]
}
export interface ExternalReservation {
  readonly request: ExternalReservationRequest
  assertPaths(paths: readonly string[]): void
  assertUnused(): void
  release(): void
}
const overlaps = (a: string, b: string) =>
  a === '' || b === '' || a === b || a.startsWith(b + '/') || b.startsWith(a + '/')

/** Runtime-only exclusion. Durable phases remain the authority after restart.
 * Shared by every filesystem instance for a host; leases are never persisted. */
export class ExternalFileCoordination {
  private readonly reservations = new Set<{
    request: ExternalReservationRequest
    invalidated: boolean
  }>()
  private readonly engineMutations = new Set<readonly string[]>()
  private readonly uses = new Map<string, number>()

  assertEnginePaths(paths: readonly string[]): void {
    const keys = paths.map(caseKey)
    for (const op of this.reservations)
      if (op.request.paths.some((path) => keys.some((key) => overlaps(caseKey(path), key))))
        throw new ExternalFilePortError('busy')
  }

  /** Take before the first await of a whole apply/rename/delete, not just its final syscall. */
  beginEngineMutation(paths: readonly string[]): () => void {
    this.assertEnginePaths(paths)
    const keys = paths.map(caseKey)
    this.engineMutations.add(keys)
    return () => this.engineMutations.delete(keys)
  }

  reserve(request: ExternalReservationRequest): ExternalReservation {
    if (!request.operationId || !request.fileId || !request.paths.length)
      throw new ExternalFilePortError('recovery-required')
    for (const path of request.paths) {
      if (
        !OwnedArtifactSchema.safeParse({
          path,
          operationId: request.operationId,
          sha: '0'.repeat(64),
          size: 0,
          role: 'retained',
        }).success
      )
        throw new ExternalFilePortError('recovery-required')
    }
    this.assertEnginePaths(request.paths)
    const copy = Object.freeze({ ...request, paths: Object.freeze([...request.paths]) })
    const keys = copy.paths.map(caseKey)
    for (const active of this.engineMutations)
      if (active.some((key) => keys.some((path) => overlaps(path, key))))
        throw new ExternalFilePortError('busy')
    if (
      (this.uses.get(copy.fileId) ?? 0) > 0 ||
      [...this.reservations].some((op) => op.request.fileId === copy.fileId)
    )
      throw new ExternalFilePortError('busy')
    const op = { request: copy, invalidated: false }
    this.reservations.add(op)
    return {
      request: copy,
      assertPaths: (paths) => {
        if (!this.reservations.has(op) || paths.some((path) => !keys.includes(caseKey(path))))
          throw new ExternalFilePortError('recovery-required')
      },
      assertUnused: () => {
        if (!this.reservations.has(op)) throw new ExternalFilePortError('recovery-required')
        if (op.invalidated || (this.uses.get(copy.fileId) ?? 0) > 0)
          throw new ExternalFilePortError('busy')
      },
      release: () => {
        this.reservations.delete(op)
      },
    }
  }

  /** A newly opened relevant leaf invalidates permission even if it closes before deletion. */
  opened(paths: readonly string[]): void {
    const keys = paths.map(caseKey)
    for (const op of this.reservations)
      if (op.request.paths.some((path) => keys.includes(caseKey(path)))) op.invalidated = true
  }

  acquireUse(fileId: string): { release(): void } {
    if ([...this.reservations].some((op) => op.request.fileId === fileId))
      throw new ExternalFilePortError('busy')
    this.uses.set(fileId, (this.uses.get(fileId) ?? 0) + 1)
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        const count = (this.uses.get(fileId) ?? 1) - 1
        if (count) this.uses.set(fileId, count)
        else this.uses.delete(fileId)
      },
    }
  }
}
