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
interface StoredScript extends ManagedScript {
  path?: string
  retiredIds?: string[]
  /** Invalidation hint only: a pending hold must not erase which receipt can arrive late. */
  lastFileId?: string
}
const key = (path: string) => `script-source:${caseKey(path)}`
// Distinct from caseKey: a case-only rename must hold the OLD spelling even though its
// destination uses the same case-folded provenance slot.
const retiredKey = (path: string) => `script-retired-path:${encodeURIComponent(path)}`
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

  private async stored(path: string): Promise<StoredScript | null> {
    const raw = await this.meta.getMeta(key(path))
    if (raw === null) return null
    const value: StoredScript = JSON.parse(String(raw))
    if (!value.binding || !sameBinding(value.binding, this.binding)) return null
    if (
      (value.fileId !== null && (typeof value.fileId !== 'string' || !value.fileId)) ||
      (value.lastFileId !== undefined &&
        (typeof value.lastFileId !== 'string' || !value.lastFileId)) ||
      (value.retiredIds !== undefined &&
        (!Array.isArray(value.retiredIds) ||
          value.retiredIds.some((id) => typeof id !== 'string' || !id)))
    ) {
      throw new Error('Script provenance is unreadable')
    }
    return value
  }
  private async retired(path: string): Promise<string[]> {
    const raw = await this.meta.getMeta(retiredKey(path))
    if (raw === null) return []
    if (typeof raw !== 'string') throw new Error('Script retirement is unreadable')
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new Error('Script retirement is unreadable')
    }
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id))
      throw new Error('Script retirement is unreadable')
    return value as string[]
  }
  private async saveRetired(path: string, ids: string[]): Promise<void> {
    const value = ids.length ? JSON.stringify(ids) : null
    await this.meta.setMeta(retiredKey(path), value)
    if ((await this.meta.getMeta(retiredKey(path))) !== value)
      throw new Error('Script retirement was not persisted')
  }
  /** Unknown in this binding is not necessarily unmanaged: another binding or a retired
   * spelling still proves the path has received managed effects. Never grant local fallback. */
  async hasSourceEvidence(path: string): Promise<boolean> {
    return (
      (await this.meta.getMeta(key(path))) !== null ||
      (await this.meta.getMeta(retiredKey(path))) !== null
    )
  }

  async lookup(path: string): Promise<ManagedScript | null> {
    const value = await this.stored(path)
    if (!value) return null
    if (value.fileId && (await this.retired(path)).includes(value.fileId))
      return { binding: { ...value.binding }, fileId: null }
    // Case-folded keys cannot grant a renamed spelling's identity to a recreated old path.
    if (value.path !== undefined && value.path !== path)
      return { binding: { ...value.binding }, fileId: null }
    return { binding: { ...value.binding }, fileId: value.fileId }
  }

  async record(path: string, fileId: string): Promise<void> {
    if (!fileId) throw new Error('Managed file identity is required')
    await this.mutation([path], async () => {
      // A ledger receipt is not proof that a renamed identity returned to this physical path.
      // Late pushes/replays may still settle their old path; keep that identity retired here.
      const previous = await this.stored(path)
      if (previous?.retiredIds?.includes(fileId) || (await this.retired(path)).includes(fileId))
        return
      await this.save(path, { binding: this.binding, fileId })
      const sha = await this.meta.getMeta(`script-pre-sync:${encodeURIComponent(path)}`)
      if (
        typeof sha === 'string' &&
        /^[a-f0-9]{64}$/.test(sha) &&
        this.binding.facet === 'personal'
      ) {
        // A pre-sync LOCAL version is already an execution decision on this device.
        // Carry only those exact bytes into the newly enrolled identity, never its latest bytes.
        const key = this.approvalKey({ binding: this.binding, fileId }, sha)
        await this.meta.setMeta(key, 'approved')
        if ((await this.meta.getMeta(key)) !== 'approved')
          throw new Error('Local script upgrade approval was not persisted')
      }
    })
  }

  /** Bootstrap data comes only from the device-local snapshot taken before the first sync. */
  async preserveLocalVersion(path: string, sha: string): Promise<void> {
    if (this.binding.facet !== 'personal' || !/^[a-f0-9]{64}$/.test(sha)) return
    const key = `script-pre-sync:${encodeURIComponent(path)}`
    await this.meta.setMeta(key, sha)
    if ((await this.meta.getMeta(key)) !== sha)
      throw new Error('Local script upgrade approval was not persisted')
  }

  /** Write this durable hold BEFORE any sync filesystem mutation, including crash recovery. */
  async pending(path: string): Promise<void> {
    await this.mutation([path], () => this.save(path, { binding: this.binding, fileId: null }))
  }

  async rename(from: string, to: string): Promise<void> {
    if (from === to) return
    await this.mutation([from, to], async () => {
      const source = await this.lookup(from)
      // Persist the restrictive source hold first: a crash cannot leave the old name with
      // usable authority. Destination keeps identity only when the source was proven.
      const previous = await this.stored(from)
      const lastFileId = source?.fileId ?? previous?.lastFileId ?? previous?.fileId
      const retired = [
        ...new Set([...(previous?.retiredIds ?? []), ...(lastFileId ? [lastFileId] : [])]),
      ]
      if (lastFileId)
        await this.saveRetired(from, [...new Set([...(await this.retired(from)), lastFileId])])
      await this.save(from, { binding: this.binding, fileId: null }, retired)
      const destination = await this.stored(to)
      // Only a proven rename into the path can deliberately return the same identity.
      const destinationRetired = (destination?.retiredIds ?? []).filter(
        (id) => id !== source?.fileId
      )
      await this.save(
        to,
        source ?? { binding: this.binding, fileId: null },
        destinationRetired,
        lastFileId ?? undefined
      )
      // A verified rename back may explicitly restore this spelling. Never clear the old
      // spelling's independent hold while writing a case-folded destination record.
      if (source?.fileId) {
        const destinationHold = await this.retired(to)
        if (destinationHold.includes(source.fileId))
          await this.saveRetired(
            to,
            destinationHold.filter((id) => id !== source.fileId)
          )
      }
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

  private async save(
    path: string,
    record: ManagedScript,
    retired?: string[],
    hint?: string
  ): Promise<void> {
    const previous = await this.stored(path)
    const retiredIds = retired ?? previous?.retiredIds ?? []
    const lastFileId = record.fileId ?? hint ?? previous?.lastFileId ?? previous?.fileId
    const value = JSON.stringify({
      ...record,
      path,
      ...(retiredIds.length ? { retiredIds } : {}),
      ...(lastFileId ? { lastFileId } : {}),
    })
    await this.meta.setMeta(key(path), value)
    if ((await this.meta.getMeta(key(path))) !== value)
      throw new Error('Script provenance was not persisted')
  }
}
