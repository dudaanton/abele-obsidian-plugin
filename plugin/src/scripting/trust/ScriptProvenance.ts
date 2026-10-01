import { caseKey } from '@abele/sync-protocol'
import { ScriptRevision } from './ScriptRevision'

export interface ScriptBinding {
  localVault: string
  endpoint: string
  vaultId: string
  principal: string
  facet: 'personal' | 'scoped'
  grantId: string | null
}
export interface ManagedScript {
  binding: ScriptBinding
  fileId: string | null
}
export interface ScriptMeta {
  getMeta(key: string): unknown
  setMeta(key: string, value: string | null): void | Promise<void>
}
const revisions = new WeakMap<ScriptMeta, ScriptRevision>()
const key = (path: string) => `script-source:${caseKey(path)}`
export const sameBinding = (a: ScriptBinding, b: ScriptBinding): boolean =>
  a.localVault === b.localVault &&
  a.endpoint === b.endpoint &&
  a.vaultId === b.vaultId &&
  a.principal === b.principal &&
  a.facet === b.facet &&
  a.grantId === b.grantId

/** Device-local immutable identity facts; never trust an extension or the latest writer. */
export class ScriptProvenance {
  private tail: Promise<void> = Promise.resolve()
  private constructor(
    private readonly meta: ScriptMeta,
    readonly binding: ScriptBinding,
    private readonly revision: ScriptRevision
  ) {}
  capture(path: string): number {
    return this.revision.capture(path)
  }
  assertRevision(path: string, generation: number): void {
    this.revision.assert(path, generation)
  }
  private mutation(paths: string[], work: () => Promise<void>): Promise<void> {
    const finish = this.revision.begin(paths)
    return this.serial(work).finally(finish)
  }
  private serial(work: () => Promise<void>): Promise<void> {
    const operation = this.tail.then(work)
    this.tail = operation.catch(() => {})
    return operation
  }

  static async open(
    meta: ScriptMeta,
    binding: ScriptBinding,
    fresh: boolean,
    revision?: ScriptRevision
  ): Promise<ScriptProvenance> {
    const identity = await meta.getMeta('script-local-vault')
    if (identity === null) {
      if (!fresh) throw new Error('Script provenance is missing; recovery is required')
      await meta.setMeta('script-local-vault', binding.localVault)
    } else if (identity !== binding.localVault) {
      throw new Error('Script provenance belongs to another local vault')
    }
    let shared = revision ?? revisions.get(meta)
    if (!shared) {
      shared = new ScriptRevision()
      revisions.set(meta, shared)
    }
    return new ScriptProvenance(meta, { ...binding }, shared)
  }

  async lookup(path: string): Promise<ManagedScript | null> {
    const raw = await this.meta.getMeta(key(path))
    if (raw === null) return null
    const value: ManagedScript = JSON.parse(String(raw))
    if (!value.binding || !sameBinding(value.binding, this.binding)) return null
    if (value.fileId !== null && (typeof value.fileId !== 'string' || !value.fileId)) {
      throw new Error('Script provenance is unreadable')
    }
    return { binding: { ...value.binding }, fileId: value.fileId }
  }

  async record(path: string, fileId: string): Promise<void> {
    if (!fileId) throw new Error('Managed file identity is required')
    await this.mutation([path], () => this.save(path, { binding: this.binding, fileId }))
  }

  /** Write this durable hold BEFORE any sync filesystem mutation, including crash recovery. */
  async pending(path: string): Promise<void> {
    await this.mutation([path], () => this.save(path, { binding: this.binding, fileId: null }))
  }

  async rename(from: string, to: string): Promise<void> {
    await this.mutation([from, to], async () => {
      const source = await this.lookup(from)
      // Unknown source is not a newly trusted local file; keep a restrictive destination hold.
      await this.save(to, source ?? { binding: this.binding, fileId: null })
      // Preserve the old alias/tombstone: detached or replaced bytes never become local trust.
    })
  }

  /** Approval is device/vault/connection/identity/SHA bound, never path or discovered code. */
  async approved(record: ManagedScript, sha: string): Promise<boolean> {
    if (
      !record.fileId ||
      record.binding.facet !== 'personal' ||
      !sameBinding(record.binding, this.binding)
    )
      return false
    return (await this.meta.getMeta(this.approvalKey(record, sha))) === 'approved'
  }

  async approve(path: string, expected: ManagedScript, sha: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Exact full-content SHA is required')
    const generation = this.capture(path)
    const current = await this.lookup(path)
    this.assertRevision(path, generation)
    if (
      !current?.fileId ||
      current.fileId !== expected.fileId ||
      current.binding.facet !== 'personal' ||
      !sameBinding(current.binding, expected.binding)
    )
      throw new Error('Script identity or policy changed during approval')
    const key = this.approvalKey(current, sha)
    await this.meta.setMeta(key, 'approved')
    if ((await this.meta.getMeta(key)) !== 'approved')
      throw new Error('Script approval was not persisted')
    this.assertRevision(path, generation)
  }

  private approvalKey(record: ManagedScript, sha: string): string {
    return `script-approval:${JSON.stringify([record.binding, record.fileId, sha])}`
  }

  private async save(path: string, record: ManagedScript): Promise<void> {
    const value = JSON.stringify(record)
    await this.meta.setMeta(key(path), value)
    if ((await this.meta.getMeta(key(path))) !== value)
      throw new Error('Script provenance was not persisted')
  }
}
