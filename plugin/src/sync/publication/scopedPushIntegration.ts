import { pushScoped, sha256, type ScopedPushOptions, type ScopedJournal } from '@abele/sync-core'
import type { ScopedManifestItem } from '@abele/sync-protocol'
import {
  bindingKey,
  LinkSnapshotStore,
  type SnapshotBinding,
  type SnapshotCandidate,
  type SnapshotMeta,
} from './LinkSnapshotStore'
import { PUBLICATION_ENABLED } from './fence'
interface UnitEvidence {
  version: 1
  requestId: string
  bodySha: string
  sourcesSha: string
  settled: { fileId: string; versionId: string; sha: string }[]
}
const hash = (v: unknown) => sha256(new TextEncoder().encode(JSON.stringify(v)))
/** Actual reviewed scoped hooks: durable unit before uploads and exact-version cache after
 * settlement. Scoped facts can NEVER become owner publication/create novelty evidence.
 */
export class ScopedPushIntegration {
  private readonly binding: SnapshotBinding
  private readonly prefix: string
  constructor(
    private readonly meta: SnapshotMeta,
    binding: SnapshotBinding,
    private readonly snapshots: LinkSnapshotStore,
    private readonly observe: (
      item: ScopedManifestItem,
      bytes: Uint8Array,
      requestId: string
    ) => Promise<SnapshotCandidate | null>,
    private readonly enabled: () => boolean = () => PUBLICATION_ENABLED
  ) {
    this.binding = JSON.parse(JSON.stringify(binding)) as SnapshotBinding
    this.prefix = 'publication-scoped-unit-v1:' + bindingKey(binding) + ':'
  }
  private fence(opts: ScopedPushOptions) {
    if (!this.enabled()) throw new Error('Scoped publication integration is disabled')
    if (!opts.stillHeld || !opts.stillHeld())
      throw new Error('Scoped publication writer ownership lost')
    const b = opts.state.binding
    if (
      this.binding.facet !== 'scoped' ||
      this.binding.issuer !== b.endpoint_identity ||
      this.binding.vaultId !== b.vault_id ||
      this.binding.grantId !== b.grant_id ||
      this.binding.principal !== b.principal_id ||
      bindingKey(this.snapshots.getBinding()) !== bindingKey(this.binding)
    )
      throw new Error('Scoped publication integration binding mismatch')
  }
  private async write(e: UnitEvidence) {
    const value = JSON.stringify({ evidence: e, checksum: await hash(e) })
    if (value.length > 1024 * 1024) throw new Error('Scoped publication evidence budget reached')
    await this.meta.setMeta(this.prefix + e.requestId, value)
    if ((await this.meta.getMeta(this.prefix + e.requestId)) !== value)
      throw new Error('Scoped publication unit was not persisted; recovery required')
  }
  private async read(id: string): Promise<UnitEvidence | null> {
    const value = await this.meta.getMeta(this.prefix + id)
    if (value === null) return null
    try {
      const v = JSON.parse(value) as { evidence: UnitEvidence; checksum: string }
      if (
        v.evidence.version !== 1 ||
        v.evidence.requestId !== id ||
        (await hash(v.evidence)) !== v.checksum ||
        !Array.isArray(v.evidence.settled) ||
        v.evidence.settled.length > 64
      )
        throw new Error()
      return v.evidence
    } catch {
      throw new Error('Scoped publication unit unreadable; recovery required')
    }
  }
  async push(opts: ScopedPushOptions) {
    this.fence(opts)
    const checkJournal = async (j: ScopedJournal, initialize: boolean) => {
      this.fence(opts)
      const old = await this.read(j.request_id),
        bodySha = await hash(j.ops),
        sourcesSha = await hash(j.sources)
      this.fence(opts)
      if (old) {
        if (old.bodySha !== bodySha || old.sourcesSha !== sourcesSha)
          throw new Error('Scoped publication request identity changed')
        return old
      }
      if (!initialize) throw new Error('Scoped publication unit missing; recovery required')
      const e: UnitEvidence = {
        version: 1,
        requestId: j.request_id,
        bodySha,
        sourcesSha,
        settled: [],
      }
      await this.write(e)
      this.fence(opts)
      return e
    }
    const report = await pushScoped({
      ...opts,
      client: {
        ...opts.client,
        binding: opts.client.binding,
        negotiate: () => opts.client.negotiate(),
        putBlob: (sha, bytes) => opts.client.putBlob(sha, bytes),
        version: (file, version) => opts.client.version(file, version),
        commit: async (request) => {
          const j = await opts.state.getJournal()
          if (!j || j.request_id !== request.request_id)
            throw new Error('Scoped publication journal missing')
          await checkJournal(j, false)
          this.fence(opts)
          return opts.client.commit(request)
        },
      },
      beforeUpload: async (j) => {
        await checkJournal(j, true)
        await opts.beforeUpload?.(j)
        this.fence(opts)
      },
      onSettled: async (incomingItem, incomingBytes, id) => {
        const item = { ...incomingItem },
          bytes = new Uint8Array(incomingBytes)
        this.fence(opts)
        const e = await this.read(id)
        if (!e) throw new Error('Scoped publication settlement unit missing')
        if (bytes.length !== item.size || (await sha256(bytes)) !== item.sha)
          throw new Error('Scoped publication settled bytes mismatch')
        // Synchronously captured exact immutable bytes, never a later disk read.
        const exact = new Uint8Array(bytes)
        if (item.kind === 'note') {
          const observed = await this.observe({ ...item }, new Uint8Array(exact), id)
          const candidate = observed
            ? (JSON.parse(JSON.stringify(observed)) as SnapshotCandidate)
            : null
          this.fence(opts)
          if (
            candidate &&
            candidate.noteId === item.file_id &&
            candidate.versionId === item.version_id &&
            (await sha256(new TextEncoder().encode(candidate.source))) === item.sha
          ) {
            await this.snapshots.settle({
              ...candidate,
              origin: 'merge',
              facts: candidate.facts.map((f) => ({
                ...f,
                ...(f.provenance
                  ? { provenance: { ...f.provenance, origin: 'received' as const } }
                  : {}),
              })),
            })
          } else
            await this.snapshots.invalidate(
              item.file_id,
              'scoped settled exact-version cache is unavailable'
            )
        }
        this.fence(opts)
        await opts.onSettled?.({ ...item }, new Uint8Array(exact), id)
        this.fence(opts)
        if (
          !e.settled.some(
            (s) =>
              s.fileId === item.file_id && s.versionId === item.version_id && s.sha === item.sha
          )
        ) {
          e.settled.push({ fileId: item.file_id, versionId: item.version_id, sha: item.sha })
          await this.write(e)
          this.fence(opts)
        }
      },
    })
    // Core retired the request only after all hooks completed. No unbounded historic unit map.
    if (report.requestId && (await opts.state.getJournal()) === null) {
      this.fence(opts)
      await this.meta.setMeta(this.prefix + report.requestId, null)
      this.fence(opts)
      if ((await this.meta.getMeta(this.prefix + report.requestId)) !== null)
        throw new Error('Scoped completed unit cleanup was not persisted')
    }
    return report
  }
}
