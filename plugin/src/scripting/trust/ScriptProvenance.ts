import { caseKey } from '@abele/sync-protocol'

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
    readonly binding: ScriptBinding
  ) {}
  private serial(work: () => Promise<void>): Promise<void> {
    const operation = this.tail.then(work)
    this.tail = operation.catch(() => {})
    return operation
  }

  static async open(
    meta: ScriptMeta,
    binding: ScriptBinding,
    fresh: boolean
  ): Promise<ScriptProvenance> {
    const identity = await meta.getMeta('script-local-vault')
    if (identity === null) {
      if (!fresh) throw new Error('Script provenance is missing; recovery is required')
      await meta.setMeta('script-local-vault', binding.localVault)
    } else if (identity !== binding.localVault) {
      throw new Error('Script provenance belongs to another local vault')
    }
    return new ScriptProvenance(meta, { ...binding })
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
    await this.serial(() => this.save(path, { binding: this.binding, fileId }))
  }

  /** Write this durable hold BEFORE any sync filesystem mutation, including crash recovery. */
  async pending(path: string): Promise<void> {
    await this.serial(() => this.save(path, { binding: this.binding, fileId: null }))
  }

  async rename(from: string, to: string): Promise<void> {
    await this.serial(async () => {
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
