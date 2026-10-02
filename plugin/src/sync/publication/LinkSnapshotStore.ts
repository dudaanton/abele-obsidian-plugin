import { sha256 } from '@abele/sync-core'

export interface SnapshotBinding {
  localVault: string
  issuer: string
  vaultId: string
  principal: string
  facet: 'personal' | 'scoped'
  grantId: string | null
}
export interface LinkFact {
  kind: 'link' | 'embed'
  spelling: string
  original: string
  start: number
  end: number
  resolvedPath: string | null
  targetId: string | null
  resolution: 'resolved' | 'unresolved' | 'ambiguous'
}
export interface CacheEvidence {
  adapter: string
  runtime: string
  generation: string
  noteId: string
  versionId: string
  sourceSha: string
  cacheSha: string
  cacheJson: string
  complete: boolean
}
export interface SnapshotCandidate {
  noteId: string
  versionId: string
  source: string
  origin: 'pull' | 'push' | 'merge' | 'restore'
  facts: LinkFact[]
  evidence: CacheEvidence
}
export interface CompleteSnapshot {
  kind: 'complete'
  binding: SnapshotBinding
  noteId: string
  versionId: string
  sha: string
  origin: SnapshotCandidate['origin']
  facts: LinkFact[]
  evidence: CacheEvidence
}
export interface UnknownSnapshot {
  kind: 'unknown'
  noteId: string
  reason: string
}
export type LinkSnapshot = CompleteSnapshot | UnknownSnapshot
export interface SnapshotMeta {
  getMeta(key: string): string | null | Promise<string | null>
  setMeta(key: string, value: string | null): void | Promise<void>
}
/** Runtime adapter must attest the exact immutable callback/version, not today's path cache. */
export type SnapshotAttestor = (candidate: SnapshotCandidate) => boolean | Promise<boolean>
export interface KnownRename {
  fileId: string
  from: string
  to: string
}
const digest = (source: string) => sha256(new TextEncoder().encode(source))
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export const bindingKey = (b: SnapshotBinding): string =>
  JSON.stringify([b.localVault, b.issuer, b.vaultId, b.principal, b.facet, b.grantId])
export const normalizedSpelling = (spelling: string): string =>
  spelling.split('#')[0].trim().normalize('NFC').toLowerCase()
const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 4096
const MAX_LINKS = 4096

/** Immutable device-local last-settled facts. No Obsidian APIs, parser, uploader or authority. */
export class LinkSnapshotStore {
  private tail: Promise<void> = Promise.resolve()
  private readonly binding: SnapshotBinding
  private readonly prefix: string
  constructor(
    private readonly meta: SnapshotMeta,
    binding: SnapshotBinding,
    private readonly attest: SnapshotAttestor
  ) {
    this.binding = copy(binding)
    this.prefix = 'link-snapshot-v1:' + bindingKey(binding) + ':'
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work)
    this.tail = next.then(
      () => {},
      () => {}
    )
    return next
  }
  private async write(key: string, value: unknown): Promise<void> {
    const encoded = JSON.stringify(value)
    await this.meta.setMeta(this.prefix + key, encoded)
    if ((await this.meta.getMeta(this.prefix + key)) !== encoded)
      throw new Error('Link snapshot persistence failed; recovery required')
  }
  private async read<T>(key: string): Promise<T | null> {
    const value = await this.meta.getMeta(this.prefix + key)
    if (value === null) return null
    try {
      const decoded: unknown = JSON.parse(value)
      if (!decoded || typeof decoded !== 'object') throw new Error('Not a snapshot record')
      return decoded as T
    } catch {
      throw new Error('Link snapshot is unreadable; recovery required')
    }
  }
  async get(noteId: string): Promise<LinkSnapshot> {
    const value = await this.read<LinkSnapshot>('note:' + noteId)
    if (!value) return { kind: 'unknown', noteId, reason: 'missing baseline' }
    if (value.noteId !== noteId || (value.kind !== 'complete' && value.kind !== 'unknown'))
      throw new Error('Link snapshot identity is unreadable; recovery required')
    if (
      value.kind === 'complete' &&
      (!value.binding ||
        bindingKey(value.binding) !== bindingKey(this.binding) ||
        !sha(value.sha) ||
        !text(value.versionId) ||
        !Array.isArray(value.facts) ||
        value.facts.length > MAX_LINKS ||
        value.evidence?.sourceSha !== value.sha ||
        value.evidence?.versionId !== value.versionId ||
        value.evidence?.noteId !== noteId ||
        !value.evidence.complete)
    )
      throw new Error('Link snapshot identity is unreadable; recovery required')
    if (
      value.kind === 'complete' &&
      (!sha(value.evidence.cacheSha) ||
        value.evidence.cacheSha !== (await digest(value.evidence.cacheJson)) ||
        value.facts.some(
          (f) =>
            !text(f.spelling) ||
            !text(f.original) ||
            !Number.isInteger(f.start) ||
            !Number.isInteger(f.end) ||
            f.start < 0 ||
            f.end - f.start !== f.original.length ||
            !['resolved', 'unresolved'].includes(f.resolution)
        ))
    )
      throw new Error('Link snapshot evidence is unreadable; recovery required')
    return copy(value)
  }
  async settle(candidate: SnapshotCandidate): Promise<LinkSnapshot> {
    // Copy synchronously BEFORE hashing or adapter awaits: callers cannot mutate our observation.
    const c = copy(candidate)
    return this.serial(async () => {
      const e = c.evidence,
        contentSha = await digest(c.source)
      const valid =
        text(c.noteId) &&
        text(c.versionId) &&
        e?.noteId === c.noteId &&
        e?.versionId === c.versionId &&
        e.sourceSha === contentSha &&
        sha(e.cacheSha) &&
        e.cacheSha === (await digest(e.cacheJson)) &&
        e.complete &&
        text(e.adapter) &&
        text(e.runtime) &&
        text(e.generation) &&
        Array.isArray(c.facts) &&
        c.facts.length <= MAX_LINKS &&
        c.facts.every(
          (f) =>
            (f.kind === 'link' || f.kind === 'embed') &&
            text(f.spelling) &&
            text(f.original) &&
            Number.isInteger(f.start) &&
            Number.isInteger(f.end) &&
            f.start >= 0 &&
            f.end <= c.source.length &&
            f.end > f.start &&
            c.source.slice(f.start, f.end) === f.original &&
            ((f.resolution === 'unresolved' && f.resolvedPath === null && f.targetId === null) ||
              (f.resolution === 'resolved' &&
                text(f.resolvedPath) &&
                (f.targetId === null || text(f.targetId))))
        ) &&
        (await this.attest(copy(c)))
      const value: LinkSnapshot = valid
        ? {
            kind: 'complete',
            binding: copy(this.binding),
            noteId: c.noteId,
            versionId: c.versionId,
            sha: contentSha,
            origin: c.origin,
            facts: c.facts,
            evidence: e,
          }
        : { kind: 'unknown', noteId: c.noteId, reason: 'unproven exact-version cache' }
      await this.write('note:' + c.noteId, value)
      // Settlement destroys pending-local novelty even when cache evidence is unknown.
      await this.meta.setMeta(this.prefix + 'create:' + c.noteId, null)
      if ((await this.meta.getMeta(this.prefix + 'create:' + c.noteId)) !== null)
        throw new Error('Pending creation settlement was not persisted; recovery required')
      return copy(value)
    })
  }
  async invalidate(noteId: string, reason: string): Promise<void> {
    await this.serial(() => this.write('note:' + noteId, { kind: 'unknown', noteId, reason }))
  }
  async seedLocalCreate(noteId: string, handle: string, origin: string): Promise<boolean> {
    return this.serial(async () => {
      if (
        origin !== 'local-create' ||
        !text(noteId) ||
        !text(handle) ||
        (await this.read('note:' + noteId)) !== null
      )
        return false
      await this.write('create:' + noteId, { handle, pending: true })
      return true
    })
  }
  async localCreate(noteId: string): Promise<{ handle: string; pending: true } | null> {
    // Snapshot persistence precedes clearing the handle. A crash/failing clear cannot revive
    // novelty for a note whose settlement (even unknown cache evidence) already survived.
    if ((await this.read('note:' + noteId)) !== null) return null
    const value = await this.read<{ handle: string; pending: true }>('create:' + noteId)
    if (value && (!text(value.handle) || value.pending !== true))
      throw new Error('Local creation evidence is unreadable; recovery required')
    return copy(value)
  }
  async rename(fileId: string, from: string, to: string): Promise<void> {
    if (!text(fileId) || !text(from) || !text(to)) throw new Error('Rename identity is required')
    await this.serial(async () => {
      const previous = await this.renames()
      if (previous.items.some((r) => r.fileId === fileId && r.from === from && r.to === to)) return
      if (previous.items.length >= MAX_LINKS) {
        await this.write('renames', { ...previous, complete: false })
        return
      }
      await this.write('renames', {
        complete: previous.complete,
        items: [...previous.items, { fileId, from, to }],
      })
    })
  }
  async renames(): Promise<{ complete: boolean; items: KnownRename[] }> {
    const value = (await this.read<{ complete: boolean; items: KnownRename[] }>('renames')) ?? {
      complete: true,
      items: [],
    }
    if (
      typeof value.complete !== 'boolean' ||
      !Array.isArray(value.items) ||
      value.items.length > MAX_LINKS ||
      value.items.some((r) => !text(r.fileId) || !text(r.from) || !text(r.to))
    )
      throw new Error('Rename evidence is unreadable; recovery required')
    return copy(value)
  }
}
