import { sha256 } from '@abele/sync-core'
import { OwnedArtifactSchema, type ExternalOperation } from './records'
import type { ExternalReservation } from './coordination'

export type OwnedArtifact = ExternalOperation['ownedArtifacts'][number]
export type ExternalFilePortReason =
  | 'busy'
  | 'collision'
  | 'local-changed'
  | 'unsupported-storage'
  | 'recovery-required'
export class ExternalFilePortError extends Error {
  constructor(readonly reason: ExternalFilePortReason) {
    super(`External files: ${reason}`)
  }
}
export type ExternalEffectPhase = 'stage' | 'install' | 'delete-original'
export interface ExternalByteExpectation {
  path: string
  sha: string
  size: number
}
export interface ExternalFilesystemPort {
  exists(path: string): Promise<boolean>
  read(path: string): Promise<Uint8Array>
  makeParents(path: string): Promise<void>
  writeStaging(path: string, bytes: Uint8Array): Promise<void>
  /** Native link on desktop; final absent check plus adapter rename on mobile. */
  install(from: string, to: string, assertEffect: () => void): Promise<void>
  readonly installation: 'native-link' | 'adapter-rename' | 'unavailable'
  removeOriginal(path: string): Promise<void>
  /** Reconcile only; cannot turn a failed effect into installation/deletion evidence. */
  reconcile(paths: readonly string[]): Promise<void>
}
export type ExternalEffectResult =
  | { status: 'installed'; method: 'native-link' | 'adapter-rename'; sourceRetained: boolean }
  | { status: 'deleted'; reclaimedBytes: number }
  | { status: 'staged' }
  | { status: 'outcome-unknown'; artifacts: OwnedArtifact[]; paths: string[] }
  | { status: 'cleanup-pending'; artifact: OwnedArtifact }

export interface ExternalEffectGuards {
  assertOwned(): void
  assertUnused(): void
  /** Must validate the committed journal phase/revision/generation and artifact ownership.
   * This synchronous guard is supplied by the attachment state machine, never a transaction
   * callback. A commit receipt by itself does not authorize an effect. */
  assertIntent(phase: ExternalEffectPhase, paths: readonly string[], artifact?: OwnedArtifact): void
}

/** Portable minimal effects, not a publication/verification/recovery state machine.
 * No constructor starts work. Only the later explicit attachment API may supply guards
 * backed by live server verification and committed durable intent. */
export class ExternalFileEffects {
  private unknown = false
  private active = true
  private readonly pending = new Set<Promise<unknown>>()
  constructor(
    private readonly fs: ExternalFilesystemPort,
    private readonly reservation: ExternalReservation,
    private readonly guards: ExternalEffectGuards
  ) {}

  private check(
    paths: readonly string[],
    phase?: ExternalEffectPhase,
    artifact?: OwnedArtifact
  ): void {
    if (!this.active || this.unknown) throw new ExternalFilePortError('recovery-required')
    this.guards.assertOwned()
    this.reservation.assertPaths(paths)
    if (phase) this.guards.assertIntent(phase, paths, artifact)
  }
  private owned(input: OwnedArtifact): OwnedArtifact {
    const artifact = OwnedArtifactSchema.parse(input)
    if (artifact.operationId !== this.reservation.request.operationId)
      throw new ExternalFilePortError('recovery-required')
    this.check([artifact.path])
    return artifact
  }
  private async matches(expected: ExternalByteExpectation): Promise<boolean> {
    const current = await this.fs.read(expected.path)
    return current.byteLength === expected.size && (await sha256(current)) === expected.sha
  }
  private ambiguous(paths: string[], artifacts: OwnedArtifact[] = []): ExternalEffectResult {
    this.unknown = true
    return { status: 'outcome-unknown', artifacts, paths }
  }
  private track<T>(work: () => Promise<T>): Promise<T> {
    // Register synchronously: even a caller that forgets to await an issued effect cannot
    // release its reservation before the host settles it.
    if (this.pending.size) return Promise.reject(new ExternalFilePortError('busy'))
    const pending = work()
    this.pending.add(pending)
    void pending.finally(() => this.pending.delete(pending)).catch(() => {})
    return pending
  }
  /** Retire the capability, then wait for already-issued promises before releasing paths. */
  async settle(): Promise<void> {
    this.active = false
    await Promise.allSettled([...this.pending])
  }

  stage(input: OwnedArtifact, bytes: Uint8Array): Promise<ExternalEffectResult> {
    return this.track(async () => {
      const artifact = this.owned(input),
        copy = new Uint8Array(bytes)
      if (!artifact.path.split('/').at(-1)?.startsWith('.abele-external-'))
        throw new ExternalFilePortError('recovery-required')
      if (copy.byteLength !== artifact.size || (await sha256(copy)) !== artifact.sha)
        throw new ExternalFilePortError('local-changed')
      this.check([artifact.path], 'stage', artifact)
      await this.fs.makeParents(artifact.path)
      if (await this.fs.exists(artifact.path)) throw new ExternalFilePortError('collision')
      this.check([artifact.path], 'stage', artifact)
      try {
        // Only the random, operation-owned incoming path is written, never the final target.
        await this.fs.writeStaging(artifact.path, copy)
        if (!(await this.matches(artifact))) return this.ambiguous([artifact.path], [artifact])
        this.check([artifact.path])
        return { status: 'staged' }
      } catch {
        return this.ambiguous([artifact.path], [artifact])
      }
    })
  }

  install(input: OwnedArtifact, target: string): Promise<ExternalEffectResult> {
    return this.track(async () => {
      const artifact = this.owned(input)
      this.check([artifact.path, target])
      if (this.fs.installation === 'unavailable')
        throw new ExternalFilePortError('unsupported-storage')
      if (artifact.path === target || !(await this.matches(artifact)))
        throw new ExternalFilePortError('local-changed')
      this.check([artifact.path, target], 'install', artifact)
      await this.fs.makeParents(target)
      // The host repeats this immediately at its mobile rename invocation.
      if (await this.fs.exists(target)) throw new ExternalFilePortError('collision')
      this.check([artifact.path, target], 'install', artifact)
      try {
        await this.fs.install(artifact.path, target, () =>
          this.check([artifact.path, target], 'install', artifact)
        )
      } catch (error) {
        if (error instanceof ExternalFilePortError && error.reason === 'collision') throw error
        // EEXIST from native link is a definite non-install; all other failures may have
        // mutated paths. Neither matching bytes nor source disappearance settles provenance.
        if ((error as { code?: string } | null)?.code === 'EEXIST')
          throw new ExternalFilePortError('collision')
        return this.ambiguous([artifact.path, target], [artifact])
      }
      try {
        this.check([artifact.path, target])
        if (!(await this.matches({ ...artifact, path: target })))
          return this.ambiguous([artifact.path, target], [artifact])
        this.check([artifact.path, target])
        await this.fs.reconcile([artifact.path, target])
        this.check([artifact.path, target])
        return {
          status: 'installed',
          method: this.fs.installation,
          sourceRetained: this.fs.installation === 'native-link',
        }
      } catch {
        return this.ambiguous([artifact.path, target], [artifact])
      }
    })
  }

  deleteOriginal(expected: ExternalByteExpectation): Promise<ExternalEffectResult> {
    return this.track(async () => {
      const copy = { ...expected }
      this.check([copy.path], 'delete-original')
      this.reservation.assertUnused()
      this.guards.assertUnused()
      if (!(await this.matches(copy))) throw new ExternalFilePortError('local-changed')
      // No journal commit, filesystem stat or network await here. A new leaf/use/ownership
      // check is synchronous. Independent writes between this hash and remove are accepted.
      this.check([copy.path], 'delete-original')
      this.reservation.assertUnused()
      this.guards.assertUnused()
      try {
        await this.fs.removeOriginal(copy.path)
        this.check([copy.path])
        if (await this.fs.exists(copy.path)) return this.ambiguous([copy.path])
        await this.fs.reconcile([copy.path])
        this.check([copy.path])
        return { status: 'deleted', reclaimedBytes: copy.size }
      } catch {
        return this.ambiguous([copy.path])
      }
    })
  }

  async retire(input: OwnedArtifact): Promise<ExternalEffectResult> {
    const artifact = this.owned(input)
    // Neither adapter exposes conditional cleanup of user-editable artifacts. Hash-then-
    // remove would extend the accepted ORIGINAL deletion race to unrelated recovery bytes.
    // Retain the journal reference; do not pretend that equal bytes authorize cleanup.
    return { status: 'cleanup-pending', artifact }
  }
}
