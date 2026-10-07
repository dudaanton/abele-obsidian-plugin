import {
  sha256,
  type OwnerPushHooks,
  type PersonalNoteHook,
  type VaultClient,
  type StateStore,
} from '@abele/sync-core'
import { storeOwnerUnit, loadOwnerUnit, type StoredOwnerUnit } from './ownerUnitStorage'
import { emptyLocalLinkUnit } from './linkUnit'
import { CommitResponseSchema, type CommitOp } from '@abele/sync-protocol'
import { MarkdownView, type App, type CachedMetadata } from 'obsidian'
import { PublicationIntents, type PushReceipt, type PublicationDelta } from './publicationIntents'
import {
  LinkSnapshotStore,
  normalizedSpelling,
  type SnapshotBinding,
  type SnapshotMeta,
  type CompleteSnapshot,
  type LinkFact,
  type SnapshotCandidate,
  type LinkSnapshot,
} from './LinkSnapshotStore'
import { SponsoredAssetsHttpPort } from '../sharing/sponsoredHttp'
import {
  PublicationDecisionStore,
  type PublicationInput,
  type LocalNoteBase,
} from './publicationDecision'
import { SharingHttpError } from '../sharing/sharingHttp'
import type { OwnerAdd } from '../sharing/sponsoredAssets'
import { PUBLICATION_ENABLED } from './fence'
import { observeLinks, type CacheObservation } from './cacheObservation'
import {
  existingPrivateTargets,
  ExistingPrivateConfirmation,
  type ExistingPrivateCandidate,
} from './existingPrivateConfirmation'
interface Observation extends CacheObservation {
  resolutionEpoch: number
}
interface ReceivedBase {
  path: string
  versionId: string
  sha: string
  localCreateHandle?: string
}
interface LocalLinkUnit {
  facts: Record<string, LinkFact[]>
  localCreates: string[]
  delayed?: Record<string, { sha: string; baseline: LinkSnapshot }>
}
interface DelayedLocalLinks {
  path: string
  sourceSha: string
  settledSha: string
  versionId: string
  baseline: LinkSnapshot | LocalNoteBase
  applied?: boolean
}
interface Paste {
  id: string
  notePath: string
  clipSha: string
  baseline: CompleteSnapshot
  before: string
  start: number
  end: number
  epoch: number
  cancelled?: boolean
  assetPath?: string
  assetHandle?: string
  assetSha?: string
  current?: Observation
  sponsor?: { fileId: string; versionId: string; sha: string }
  done?: boolean
}
interface Options {
  app: App
  eventTarget?: Document
  configurationRoots?: () => string[]
  meta: SnapshotMeta
  state: StateStore
  client: VaultClient
  binding: SnapshotBinding
  token: () => string | null
  grants: string[]
  fetch: typeof fetch
  enabled?: () => boolean
  held: () => boolean
  /** The host's personal ledger may be in an automatic transaction outside its UI queue. */
  settling?: () => boolean
  /** Schedule outside the engine transaction; cache callbacks themselves never do HTTP. */
  linksChanged?: () => void
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const hash = (v: unknown) => sha256(new TextEncoder().encode(JSON.stringify(v)))
/** Exact source is only the native image embed (+ line breaks) at the trusted selection. */
export function nativePasteIntroduction(
  before: string,
  start: number,
  end: number,
  source: string,
  path: string,
  fact: LinkFact
) {
  if (
    fact.kind !== 'embed' ||
    fact.resolvedPath !== path ||
    start < 0 ||
    end < start ||
    end > before.length
  )
    return false
  const prefix = before.slice(0, start),
    suffix = before.slice(end)
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) return false
  const stop = source.length - suffix.length
  if (fact.start < start || fact.end > stop || source.slice(fact.start, fact.end) !== fact.original)
    return false
  return (
    /^[\r\n]*$/.test(source.slice(start, fact.start)) &&
    /^[\r\n]*$/.test(source.slice(fact.end, stop))
  )
}
export function nativeAssetEligible(path: string, roots: string[] | undefined) {
  if (!roots || !roots.length || roots.some((r) => !r)) return false
  const parts = path.split('/')
  return (
    !!path &&
    !path.startsWith('/') &&
    parts.every((p) => !!p && p !== '.' && p !== '..' && !p.startsWith('.')) &&
    !/\.(?:js|mjs|cjs|ts|py|sh|wasm)$/i.test(path) &&
    !roots.some(
      (r) =>
        path.toLowerCase() === r.toLowerCase() ||
        path.toLowerCase().startsWith(r.toLowerCase() + '/')
    )
  )
}
function project(
  ops: CommitOp[],
  body: ReturnType<typeof CommitResponseSchema.parse>
): PushReceipt['outcomes'] {
  return body.results.map((r, index) => {
    if (r.status === 'rejected') return { index, status: 'rejected', code: r.code }
    const creation = body.creation_outcomes?.find((c) => c.index === index)?.kind
    return {
      index,
      status:
        ops[index].op === 'create'
          ? creation === 'novel'
            ? 'created'
            : creation === 'collision'
              ? 'conflict'
              : 'adopted'
          : r.status,
      fileId: r.file_id,
      versionId: r.version_id,
      sha: r.sha,
      path: r.path,
    }
  })
}
/** Supported synchronous changed(data,cache) observations + trusted image paste event. No body
 * parser/timer or latest-path cache certifies an older version. All novelty comes from wire receipts.
 * Metadata MUST live outside the personal ledger transaction; writes precede network effects.
 */
export class NativeOwnerPublication {
  private pastes: Paste[] = []
  private observations = new Map<string, Observation>()
  private resolutionEpoch = 0
  private readonly localNotes = new Set<string>()
  private work: Promise<void> = Promise.resolve()
  private unhookPaste: (() => void) | null = null
  private remote = new Set<string>()
  private epochs = new Map<string, number>()
  private live = false
  private cacheErrors = 0
  private pasteEvents = 0
  private lastReason = 'none'
  private refs: { target: { offref(ref: unknown): void }; ref: unknown }[] = []
  private originalCommit: VaultClient['commitRaw'] | null = null
  private readonly prefix: string
  private readonly snapshots: LinkSnapshotStore
  private readonly intents: PublicationIntents
  private readonly assets: SponsoredAssetsHttpPort
  readonly confirmation: ExistingPrivateConfirmation
  private readonly deletedTargets = new Map<string, string | null>()
  constructor(private readonly options: Options) {
    this.prefix = 'native-owner-v1:' + JSON.stringify(options.binding) + ':'
    this.snapshots = new LinkSnapshotStore(options.meta, options.binding, (c) =>
      this.attestCache(c)
    )
    this.assets = new SponsoredAssetsHttpPort({
      baseUrl: options.binding.issuer,
      fetch: options.fetch,
      enabled: () => this.enabled(),
      context: {
        facet: 'personal',
        vaultId: options.binding.vaultId,
        principalId: options.binding.principal,
        token: options.token,
      },
    })
    this.confirmation = new ExistingPrivateConfirmation(
      new PublicationDecisionStore(options.meta),
      options.binding,
      options.grants,
      {
        observe: (c, grantId) => this.existingObservation(c, grantId),
        add: (request) => this.addExisting(request),
        held: () => this.enabled() && this.live && options.held() && !options.settling?.(),
        questionEpoch: () => this.resolutionEpoch,
      }
    )
    this.intents = new PublicationIntents(
      options.meta,
      options.binding,
      {
        attest: (i) => this.attestInput(i),
        verifySponsor: (i) => this.verifySponsor(i),
        verifyReceipt: (r) => this.verifyReceipt(r),
        inspect: (g, t, s) => this.authority(g, t, s),
        lookup: async () => null,
        apply: (d) => this.apply(d),
      },
      () => this.enabled(),
      () => this.live && options.held()
    )
  }
  /** The host supplies only persisted, owner-created grant IDs; changing audiences cancels
   * in-flight question reads. Server visibility and sponsor proofs remain the authority. */
  setAudiences(grants: string[]): void {
    this.check()
    this.resolutionEpoch++
    this.options.grants.splice(0, this.options.grants.length, ...grants)
  }
  private enabled() {
    return (this.options.enabled ?? (() => PUBLICATION_ENABLED))()
  }
  private check() {
    if (!this.enabled()) throw new Error('Native owner publication disabled')
    if (!this.live || !this.options.held()) throw new Error('Native owner publication writer lost')
  }
  private queue(fn: () => Promise<void>) {
    const task = this.work.then(fn)
    this.work = task.catch(() => {
      this.cacheErrors++
    })
    return task
  }
  async flush() {
    await this.work
  }
  private async persisted(key: string, value: unknown) {
    this.check()
    if (key.startsWith('unit:')) {
      const unit = value as {
          ops: CommitOp[]
          handles: Record<number, string>
          submitted?: boolean
          prepared?: { ops: CommitOp[]; handles: Record<number, string> }
        },
        prepared = unit.prepared ?? unit
      value = {
        version: 2,
        ...storeOwnerUnit(
          { requestId: key.slice(5), ops: prepared.ops, createHandles: prepared.handles },
          { requestId: key.slice(5), ops: unit.ops, createHandles: unit.handles },
          !!unit.submitted
        ),
      }
    }
    const record = { binding: this.options.binding, key, value }
    const raw = JSON.stringify({ ...record, checksum: await hash(record) })
    if (raw.length > 2 * 1024 * 1024) throw new Error('Native owner evidence budget exceeded')
    await this.options.meta.setMeta(this.prefix + key, raw)
    this.check()
    if ((await this.options.meta.getMeta(this.prefix + key)) !== raw)
      throw new Error('Native owner evidence was not persisted')
  }
  private async read<T = unknown>(key: string): Promise<T | null> {
    this.check()
    const raw = await this.options.meta.getMeta(this.prefix + key)
    if (raw === null) return null
    try {
      const r = JSON.parse(raw),
        record = { binding: r.binding, key: r.key, value: r.value }
      if (
        r.key !== key ||
        JSON.stringify(r.binding) !== JSON.stringify(this.options.binding) ||
        r.checksum !== (await hash(record))
      )
        throw new Error()
      if (key.startsWith('unit:') && r.value?.version === 2) {
        const decoded = loadOwnerUnit(r.value as StoredOwnerUnit)
        if (decoded.prepared.requestId !== key.slice(5)) throw new Error()
        return {
          ops: decoded.actual.ops,
          handles: decoded.actual.createHandles,
          submitted: decoded.bound,
          ...(decoded.bound
            ? { prepared: { ops: decoded.prepared.ops, handles: decoded.prepared.createHandles } }
            : {}),
        } as T
      }
      if (key.startsWith('receipt:') && r.value?.opsSha) {
        const unit = await this.read<{ ops: CommitOp[]; submitted?: boolean }>(
          'unit:' + key.slice(8)
        )
        if (!unit?.submitted || (await hash(unit.ops)) !== r.value.opsSha) throw new Error()
        return { ops: unit.ops, body: r.value.body } as T
      }
      return r.value as T
    } catch {
      throw new Error('Native owner evidence corrupt or checksum changed; recovery required')
    }
  }
  private async save() {
    if (this.pastes.length > 64) throw new Error('Native owner paste budget exceeded')
    await this.persisted('pastes', this.pastes)
  }
  async start(fresh: boolean) {
    if (!this.enabled()) throw new Error('Native owner publication disabled')
    this.live = true
    const raw = await this.read<Paste[]>('pastes')
    if (raw !== null) {
      if (!Array.isArray(raw) || raw.length > 64)
        throw new Error('Native owner evidence corrupt; recovery required')
      this.pastes = raw
    } else if (fresh) {
      await this.save()
      await this.intents.initialize()
    } else throw new Error('Native owner evidence missing; recovery required')
    const app = this.options.app
    const changed = app.metadataCache.on('changed', (file, data, cache) => {
      this.resolutionEpoch++
      const path = file.path,
        source = String(data),
        snapshot = copy(cache)
      void this.queue(() => this.observe(path, source, snapshot))
        .then(() => this.options.linksChanged?.())
        .catch(() => {})
    })
    this.refs.push({ target: app.metadataCache, ref: changed })
    const resolved = app.metadataCache.on('resolved', () => {
      this.resolutionEpoch++
      // This is an invalidation/wakeup, not permission to certify cached source bytes.
      this.options.linksChanged?.()
    })
    this.refs.push({ target: app.metadataCache, ref: resolved })
    // Native capture-phase observer: never handles/cancels Obsidian's default paste operation.
    // Scope to this vault's ACTIVE source editor, not arbitrary form fields/another window.
    const target = this.options.eventTarget ?? document
    const paste = (event: ClipboardEvent) => {
      this.pasteEvents++
      if (!event.isTrusted) {
        this.lastReason = 'untrusted-or-no-file'
        return
      }
      const info = app.workspace.getActiveViewOfType(MarkdownView),
        editor = info?.editor
      if (
        !info?.file ||
        !editor ||
        info.getMode() !== 'source' ||
        !info.contentEl.contains(event.target as Node)
      ) {
        this.lastReason = 'untrusted-or-no-file'
        return
      }
      const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith('image/')
      )
      if (!file) {
        this.lastReason = 'no-clipboard-image'
        return
      }
      const path = info.file.path,
        before = String(editor.getValue()),
        start = editor.posToOffset(editor.getCursor('from')),
        end = editor.posToOffset(editor.getCursor('to')),
        epoch = this.epochs.get(path) ?? 0,
        bytes = file.arrayBuffer()
      // Queue synchronously before Obsidian's asset-create/default-paste handler can run.
      void this.queue(async () => {
        this.check()
        const entry = await this.options.state.get(path)
        if (!entry || (await sha256(new TextEncoder().encode(before))) !== entry.sha) {
          this.lastReason = 'editor-baseline-bytes-differ'
          return
        }
        const baseline = await this.snapshots.get(entry.fileId)
        if (baseline.kind !== 'complete' || baseline.versionId !== entry.versionId) {
          this.lastReason = 'unknown-version-baseline'
          return
        }
        const data = new Uint8Array(await bytes)
        if ((this.epochs.get(path) ?? 0) !== epoch) return
        if (data.length > 2 * 1024 * 1024) return
        this.lastReason = 'captured-native-paste'
        this.pastes.push({
          id: crypto.randomUUID(),
          notePath: path,
          clipSha: await sha256(data),
          baseline,
          before,
          start,
          end,
          epoch,
        })
        await this.save()
      }).catch(() => {})
    }
    target.addEventListener('paste', paste, true)
    this.unhookPaste = () => target.removeEventListener('paste', paste, true)
    const create = app.vault.on('create', (file) => {
      this.resolutionEpoch++
      const path = file.path
      if (this.remote.has(path)) return
      if (path.endsWith('.md')) {
        this.localNotes.add(path)
        return
      }
      void this.queue(async () => {
        this.check()
        if (await this.options.state.get(path)) return
        const sha = await sha256(new Uint8Array(await app.vault.adapter.readBinary(path)))
        const p = this.pastes.find((p) => !p.done && !p.assetPath && p.clipSha === sha)
        if (p) {
          p.assetPath = path
          p.assetSha = sha
          await this.save()
        }
      }).catch(() => {})
    })
    this.refs.push({ target: app.vault, ref: create })
    const rename = app.vault.on('rename', (file, from) => {
      this.resolutionEpoch++ // Invalidate derived resolutions, not immutable last-synced facts.
      const to = file.path
      if (this.localNotes.delete(from)) this.localNotes.add(to)
      void this.queue(async () => {
        const entry = (await this.options.state.get(from)) ?? (await this.options.state.get(to))
        if (entry) await this.snapshots.rename(entry.fileId, from, to)
      }).catch(() => {})
    })
    this.refs.push({ target: app.vault, ref: rename })
    const deleted = app.vault.on('delete', (file) => {
      this.resolutionEpoch++
      const path = file.path
      this.localNotes.delete(path)
      this.deletedTargets.set(path, null)
      void this.queue(async () => {
        this.deletedTargets.set(path, (await this.options.state.get(path))?.fileId ?? null)
      }).catch(() => {})
    })
    this.refs.push({ target: app.vault, ref: deleted })
    const original = this.options.client.commitRaw.bind(this.options.client)
    // Restore the exact method reference to the SAME receiver; never invoke it unbound.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- exact reference is restored to the same client
    this.originalCommit = this.options.client.commitRaw
    this.options.client.commitRaw = async (ops, key) => {
      this.check()
      const candidate = await this.read<{
        ops: CommitOp[]
        handles: Record<number, string>
        submitted?: boolean
        prepared?: { ops: CommitOp[]; handles: Record<number, string> }
      }>('unit:' + key)
      if (candidate) {
        // Upload admission runs AFTER beforeUpload. Bind the exact durable submitted core
        // request now, before transport, rather than accepting a reduced receipt afterward.
        const journal = await this.options.state.getJournal()
        if (
          !journal ||
          journal.idempotencyKey !== key ||
          journal.publicationPhase !== 'submitted' ||
          !journal.ownerBinding ||
          journal.ownerBinding.issuer !== this.options.binding.issuer ||
          journal.ownerBinding.vaultId !== this.options.binding.vaultId ||
          JSON.stringify(journal.ops) !== JSON.stringify(ops)
        )
          throw new Error('Exact durable submitted owner journal required')
        const handles = Object.fromEntries(
          ops.flatMap((op, index) =>
            op.op === 'create'
              ? [[index, `${journal.batchId}:${journal.operationIndices?.[index] ?? index}`]]
              : []
          )
        )
        if (
          candidate.submitted &&
          (JSON.stringify(candidate.ops) !== JSON.stringify(ops) ||
            JSON.stringify(candidate.handles) !== JSON.stringify(handles))
        )
          throw new Error('Native owner submitted request identity changed')
        await this.intents.bindSubmitted({ requestId: key, ops: copy(ops), createHandles: handles })
        if (!candidate.submitted)
          await this.persisted('unit:' + key, {
            ops: copy(ops),
            handles,
            submitted: true,
            prepared: { ops: candidate.ops, handles: candidate.handles },
          })
        this.check()
      } else if (
        this.pastes.some(
          (p) =>
            !p.done &&
            p.assetHandle &&
            ops.some((op) => op.op === 'create' && op.path === p.assetPath && op.sha === p.assetSha)
        )
      )
        throw new Error('Missing prepared native owner unit; recovery required')
      const outcome = await original(ops, key)
      this.check()
      const body = CommitResponseSchema.parse(outcome.body)
      if (await this.read('unit:' + key))
        await this.persisted('receipt:' + key, { opsSha: await hash(ops), body: copy(body) })
      return outcome
    }
  }
  async beforeRemote(paths: string[]) {
    await this.work
    for (const path of paths) {
      this.remote.add(path)
      this.localNotes.delete(path)
      this.epochs.set(path, (this.epochs.get(path) ?? 0) + 1)
      for (const p of this.pastes.filter((p) => p.notePath === path && !p.done)) p.cancelled = true
    }
    await this.save()
  }
  private async observe(path: string, source: string, cache: CachedMetadata) {
    this.check()
    const resolutionEpoch = this.resolutionEpoch
    const o = {
      ...(await observeLinks(this.options.app, this.options.state, path, source, cache)),
      resolutionEpoch,
    }
    this.observations.set(path, o)
    for (const p of this.pastes.filter((p) => !p.done && p.notePath === path)) p.current = copy(o)
    await this.save()
    const waiting = (await this.read<Record<string, ReceivedBase>>('received-bases')) ?? {}
    for (const [noteId, base] of Object.entries(waiting)) {
      if (base.path !== path || base.sha !== o.sha) continue
      const current = await this.options.state.byFileId(noteId),
        previous = await this.snapshots.get(noteId)
      if (
        current?.versionId === base.versionId &&
        current.sha === base.sha &&
        previous.kind === 'unknown'
      ) {
        if (base.localCreateHandle) {
          const renames = await this.snapshots.renames()
          await this.preserveCandidates(
            noteId,
            existingPrivateTargets(
              this.localBase(noteId, base.localCreateHandle),
              o.facts,
              renames.items
            )
          )
        }
        await this.settleObservation(
          noteId,
          base.versionId,
          o,
          base.localCreateHandle ? 'push' : 'pull'
        )
      }
      delete waiting[noteId]
      await this.persisted('received-bases', waiting)
    }
    await this.recoverLocalLinks(path, o)
  }
  private async recoverLocalLinks(path: string, o: Observation) {
    const waiting =
      (await this.read<Record<string, DelayedLocalLinks>>('delayed-local-links')) ?? {}
    for (const [noteId, pending] of Object.entries(waiting)) {
      if (pending.path !== path || pending.sourceSha !== o.sha) continue
      // A native link can resolve before the image obtains its sync identity. Keep the
      // exact local introduction evidence until that identity exists; no new callback is needed.
      const incomplete = o.facts.some((f) => !f.targetId)
      const current = await this.options.state.byFileId(noteId)
      if (current?.versionId === pending.versionId && current.sha === pending.settledSha) {
        const renames = await this.snapshots.renames()
        await this.preserveCandidates(
          noteId,
          existingPrivateTargets(pending.baseline, o.facts, renames.items)
        )
        if (current.sha === o.sha) {
          await this.settleObservation(noteId, current.versionId, o, 'push')
          if (pending.applied) {
            for (const p of this.pastes.filter(
              (p) => !p.done && !p.cancelled && p.notePath === path && p.current?.sha === o.sha
            ))
              p.sponsor = { fileId: noteId, versionId: current.versionId, sha: current.sha }
            await this.save()
          }
        }
      }
      if (current?.versionId === pending.versionId && incomplete) continue
      delete waiting[noteId]
      await this.persisted('delayed-local-links', waiting)
    }
  }
  private localBase(noteId: string, handle: string): LocalNoteBase {
    return {
      kind: 'local-create',
      binding: this.options.binding,
      noteId,
      handle,
      pending: true,
      hasLedgerIdentity: false,
    }
  }
  private async preserveCandidates(noteId: string, targets: LinkFact[]) {
    if (!targets.length) return
    const pending = (await this.read<ExistingPrivateCandidate[]>('existing-candidates')) ?? []
    for (const target of targets) {
      if (
        target.targetId &&
        target.resolvedPath &&
        !pending.some((c) => c.sponsorId === noteId && c.targetId === target.targetId)
      )
        pending.push({
          sponsorId: noteId,
          targetId: target.targetId,
          targetPath: target.resolvedPath,
        })
    }
    await this.persisted('existing-candidates', pending)
  }
  private async settleObservation(
    noteId: string,
    versionId: string,
    o: Observation,
    origin: SnapshotCandidate['origin']
  ) {
    return this.snapshots.settle({
      noteId,
      versionId,
      source: o.source,
      origin,
      facts: copy(o.facts),
      evidence: {
        adapter: 'obsidian-changed',
        runtime: 'desktop',
        generation: o.generation,
        noteId,
        versionId,
        sourceSha: o.sha,
        cacheSha: o.cacheSha,
        cacheJson: o.cacheJson,
        complete: true,
      },
    })
  }
  private async exactCache(path: string, sha: string): Promise<Observation | null> {
    await this.work
    const old = this.observations.get(path)
    // Settlement never waits for a future callback. Existing exact source/cache bytes remain
    // reusable after a rename, but their derived target identities must be resolved again.
    if (old?.sha !== sha) return null
    if (old.resolutionEpoch === this.resolutionEpoch && !old.facts.some((f) => !f.targetId))
      return copy(old)
    const resolutionEpoch = this.resolutionEpoch
    const fresh = {
      ...(await observeLinks(
        this.options.app,
        this.options.state,
        path,
        old.source,
        JSON.parse(old.cacheJson) as CachedMetadata
      )),
      resolutionEpoch,
    }
    if (resolutionEpoch !== this.resolutionEpoch || this.observations.get(path) !== old) return null
    this.observations.set(path, fresh)
    for (const paste of this.pastes.filter(
      (p) => !p.done && !p.cancelled && p.notePath === path && p.current?.sha === sha
    ))
      paste.current = copy(fresh)
    return copy(fresh)
  }
  private attestCache(c: SnapshotCandidate) {
    return [...this.observations.values()].some(
      (o) =>
        o.source === c.source &&
        o.sha === c.evidence.sourceSha &&
        o.cacheJson === c.evidence.cacheJson &&
        o.cacheSha === c.evidence.cacheSha &&
        o.generation === c.evidence.generation
    )
  }
  private async attestInput(i: PublicationInput) {
    const p = this.pastes.find((p) => p.id === i.owner.baseCreateHandle)
    if (
      !p?.current ||
      p.cancelled ||
      !nativeAssetEligible(i.target.path, this.options.configurationRoots?.())
    )
      return false
    try {
      if (
        (await sha256(
          new TextEncoder().encode(await this.options.app.vault.adapter.read(p.notePath))
        )) !== i.current.sha
      )
        return false
    } catch {
      return false
    }
    return (
      this.pastes.some(
        (p) =>
          !p.cancelled &&
          p.id === i.owner.baseCreateHandle &&
          p.current?.sha === i.current.sha &&
          p.assetHandle === i.target.create?.handle &&
          p.assetSha === i.target.sha &&
          p.sponsor?.versionId === i.current.versionId
      ) &&
      [p.current].some(
        (o) =>
          o.sha === i.current.sha &&
          o.cacheSha === i.current.evidence.cacheSha &&
          o.generation === i.current.evidence.generation
      )
    )
  }
  private async verifySponsor(i: PublicationInput) {
    const p = this.pastes.find((p) => p.id === i.owner.baseCreateHandle)
    if (
      !p ||
      p.cancelled ||
      !nativeAssetEligible(i.target.path, this.options.configurationRoots?.())
    )
      return false
    try {
      if (
        (await sha256(
          new TextEncoder().encode(await this.options.app.vault.adapter.read(p.notePath))
        )) !== i.current.sha
      )
        return false
    } catch {
      return false
    }
    return (
      !!p?.sponsor &&
      p.sponsor.fileId === i.current.noteId &&
      p.sponsor.versionId === i.current.versionId &&
      p.sponsor.sha === i.current.sha
    )
  }
  private async verifyReceipt(r: PushReceipt) {
    const raw = await this.read<{ ops: CommitOp[]; body: unknown }>('receipt:' + r.requestId)
    if (!raw) return false
    const wire = raw,
      body = CommitResponseSchema.parse(wire.body)
    return (
      JSON.stringify(wire.ops) === JSON.stringify(r.ops) &&
      JSON.stringify(project(wire.ops, body)) === JSON.stringify(r.outcomes)
    )
  }
  private async authority(grantId: string, targetId?: string, sponsorId?: string) {
    this.checkEffects()
    const view = await this.assets.read(grantId),
      target = targetId ? await this.options.state.byFileId(targetId) : null
    let sponsor: Awaited<ReturnType<SponsoredAssetsHttpPort['sponsorProof']>> | null = null
    this.checkEffects()
    if (sponsorId) sponsor = await this.assets.sponsorProof(grantId, sponsorId)
    else {
      const pending = this.pastes.find((p) => !p.done && p.sponsor)
      if (pending?.sponsor)
        sponsor = await this.assets.sponsorProof(grantId, pending.sponsor.fileId)
    }
    return {
      grantId,
      active: view.active,
      revision: view.revision,
      withdrawalGeneration: view.withdrawalGeneration,
      publicationGeneration: 0,
      admissionGeneration: sponsor?.admissionGeneration ?? 0,
      targetFileId: target?.fileId,
      targetVersionId: target?.versionId,
      sponsorFileId: sponsor?.fileId,
      sponsorVersionId: sponsor?.versionId,
    }
  }
  private checkEffects() {
    this.check()
    if (this.options.settling?.()) throw new Error('Publication waits for personal settlement')
  }
  private async apply(d: PublicationDelta) {
    this.checkEffects()
    try {
      await this.assets.add({
        grantId: d.grantId,
        expectedRevision: d.expectedRevision,
        withdrawalGeneration: d.withdrawalGeneration,
        intentId: d.intentId,
        decisionDeviceId: this.options.binding.principal,
        target: { ...d.target, eligible: true },
        sponsors: [
          {
            fileId: d.sponsor.fileId,
            versionId: d.sponsor.versionId,
            admissionGeneration: d.admissionGeneration,
            inScope: true,
            intrinsic: true,
          },
        ],
        reason: 'new-local',
      })
      return { status: 'applied' as const }
    } catch (e) {
      if ((e as { code?: string }).code === 'conflict') return { status: 'cas-conflict' as const }
      throw e
    }
  }
  private async addExisting(request: OwnerAdd) {
    this.check()
    const sponsor = await this.options.state.byFileId(request.sponsors[0].fileId)
    const o = sponsor && (await this.exactCache(sponsor.path, sponsor.sha))
    const epoch = this.resolutionEpoch
    const target = await this.options.state.get(request.target.path)
    if (
      !sponsor ||
      !o ||
      target?.fileId !== request.target.fileId ||
      target.path !== request.target.path ||
      target.versionId !== request.target.versionId ||
      (await sha256(
        new Uint8Array(await this.options.app.vault.adapter.readBinary(sponsor.path))
      )) !== o.sha ||
      (await sha256(
        new Uint8Array(await this.options.app.vault.adapter.readBinary(target.path))
      )) !== request.target.sha ||
      epoch !== this.resolutionEpoch
    )
      throw new Error('Publication reference changed or evidence unavailable before transport')
    // No await between this final live resolution and transport: the reducer's hashing and
    // durable writes cannot turn an earlier observation into permission for a different link.
    if (
      !o.facts.some(
        (f) =>
          this.options.app.metadataCache.getFirstLinkpathDest(f.spelling, sponsor.path)?.path ===
          target.path
      )
    )
      throw new Error('Publication reference changed before transport')
    this.checkEffects()
    return this.assets.add(request)
  }
  private async existingObservation(c: ExistingPrivateCandidate, grantId: string) {
    this.check()
    if (this.options.settling?.()) return undefined
    const target = await this.options.state.byFileId(c.targetId),
      sponsor = await this.options.state.byFileId(c.sponsorId)
    if (
      !target ||
      !sponsor ||
      !nativeAssetEligible(target.path, this.options.configurationRoots?.())
    )
      return null
    if (this.deletedTargets.has(target.path)) {
      const oldId = this.deletedTargets.get(target.path)
      if (!oldId || oldId === target.fileId) return null
      this.deletedTargets.delete(target.path)
    }
    const renames = await this.snapshots.renames()
    if (
      renames.items.some(
        (r) =>
          r.fileId === target.fileId &&
          !nativeAssetEligible(r.from, this.options.configurationRoots?.())
      )
    )
      return null
    const o = await this.exactCache(sponsor.path, sponsor.sha)
    if (!o) return undefined
    const linkedNow = async () => {
      const epoch = this.resolutionEpoch
      for (const fact of o.facts) {
        const path = this.options.app.metadataCache.getFirstLinkpathDest(
          fact.spelling,
          sponsor.path
        )?.path
        if (path !== target.path) continue
        const current = await this.options.state.get(path)
        if (epoch !== this.resolutionEpoch) return undefined
        if (current?.fileId === target.fileId) return true
      }
      return epoch === this.resolutionEpoch ? false : undefined
    }
    const unchanged = async () => {
      const t = await this.options.state.byFileId(target.fileId),
        s = await this.options.state.byFileId(sponsor.fileId)
      return (
        !this.deletedTargets.has(target.path) &&
        t?.versionId === target.versionId &&
        t.path === target.path &&
        s?.versionId === sponsor.versionId &&
        s.path === sponsor.path &&
        (await sha256(
          new Uint8Array(await this.options.app.vault.adapter.readBinary(target.path))
        )) === target.sha &&
        (await sha256(
          new Uint8Array(await this.options.app.vault.adapter.readBinary(sponsor.path))
        )) === sponsor.sha
      )
    }
    try {
      if (!(await unchanged())) return undefined
      const linked = await linkedNow()
      if (linked !== true) return linked === undefined ? undefined : null
      if (this.options.settling?.()) return undefined
      const view = await this.assets.visibility(grantId, target.fileId)
      if (this.options.settling?.()) return undefined
      const proof = await this.assets.sponsorProof(grantId, sponsor.fileId)
      if (proof.versionId !== sponsor.versionId || !(await unchanged())) return undefined
      const stillLinked = await linkedNow()
      if (stillLinked !== true) return stillLinked === undefined ? undefined : null
      this.check()
      return {
        binding: this.options.binding,
        target: {
          fileId: target.fileId,
          versionId: target.versionId,
          sha: target.sha,
          path: target.path,
          eligible: true,
        },
        sponsor: { ...proof, path: sponsor.path },
        audience: {
          grantId,
          label: view.label,
          active: true,
          alreadyShared: view.visible,
          revision: view.revision,
          withdrawalGeneration: view.withdrawalGeneration,
        },
        linked: true,
      }
    } catch (error) {
      if (error instanceof SharingHttpError && error.code === 'not_found') return null
      throw error
    }
  }
  /** Called after a sync transaction finishes; HTTP and questions never enter settlement. */
  async refreshPublication() {
    this.check()
    if (this.options.settling?.()) return
    await this.intents.retrySettled()
    const delayed =
      (await this.read<Record<string, DelayedLocalLinks>>('delayed-local-links')) ?? {}
    for (const pending of Object.values(delayed)) {
      const observation = await this.exactCache(pending.path, pending.sourceSha)
      if (observation) await this.queue(() => this.recoverLocalLinks(pending.path, observation))
    }
    const candidates = (await this.read<ExistingPrivateCandidate[]>('existing-candidates')) ?? []
    const remaining = await this.confirmation.refresh(candidates)
    const key = (c: ExistingPrivateCandidate) => JSON.stringify([c.sponsorId, c.targetId])
    const keep = new Set(remaining.map(key)),
      consumed = new Set(candidates.filter((c) => !keep.has(key(c))).map(key))
    if (consumed.size)
      await this.queue(async () => {
        const current = (await this.read<ExistingPrivateCandidate[]>('existing-candidates')) ?? []
        await this.persisted(
          'existing-candidates',
          current.filter((c) => !consumed.has(key(c)))
        )
      })
  }
  readonly hooks: OwnerPushHooks & { onPersonalNoteApplied: PersonalNoteHook } = {
    onPersonalNoteApplied: async (event, bytes) => {
      this.check()
      if (
        event.source !== 'personal' ||
        event.automatic !== 'enabled' ||
        event.deliveryId !== `${event.fileId}:${event.versionId}` ||
        bytes.length !== event.size ||
        (await sha256(bytes)) !== event.sha
      )
        throw new Error('Personal note delivery integrity differs')
      const current = await this.options.state.byFileId(event.fileId)
      if (
        !current ||
        current.versionId !== event.versionId ||
        current.wirePath !== event.path ||
        current.sha !== event.sha
      )
        throw new Error('Delivery is not the current recorded personal version')
      const observation = await this.exactCache(current.path, event.sha)
      if (!observation) {
        await this.queue(async () => {
          const arrived = this.observations.get(current.path)
          if (arrived?.sha === event.sha) {
            await this.settleObservation(event.fileId, event.versionId, arrived, 'pull')
            return
          }
          const waiting = (await this.read<Record<string, ReceivedBase>>('received-bases')) ?? {}
          waiting[event.fileId] = { path: current.path, versionId: event.versionId, sha: event.sha }
          await this.persisted('received-bases', waiting)
          await this.snapshots.invalidate(event.fileId, 'No exact received native callback cache')
        })
        return
      }
      // Arrival supplies a last-synced base, never owner introduction/execution consent.
      await this.settleObservation(event.fileId, event.versionId, observation, 'pull')
    },
    beforeUpload: async (unit) => {
      this.check()
      await this.work
      const local: LocalLinkUnit = { facts: {}, localCreates: [], delayed: {} }
      for (const o of unit.operations) {
        if (!('sha' in o.op) || !o.op.sha) continue
        const path =
          o.op.op === 'create' ? o.op.path : (await this.options.state.byFileId(o.op.file_id))?.path
        const observation = path?.endsWith('.md') ? await this.exactCache(path, o.op.sha) : null
        if (path?.endsWith('.md')) {
          if (observation?.sha === o.op.sha) local.facts[o.handle] = copy(observation.facts)
          if (
            o.op.op === 'modify' &&
            (!observation || observation.facts.some((f) => !f.targetId))
          ) {
            const baseline = await this.snapshots.get(o.op.file_id)
            if (baseline.kind === 'complete' && baseline.versionId === o.op.base_version_id)
              local.delayed![o.handle] = { sha: o.op.sha, baseline }
          }
          if (
            o.op.op === 'create' &&
            this.localNotes.has(path) &&
            !this.remote.has(path) &&
            !(await this.options.state.get(path))
          )
            local.localCreates.push(o.handle)
        }
      }
      if (!emptyLocalLinkUnit(local))
        await this.persisted('link-unit:' + unit.idempotencyKey, local)
      const holds: number[] = [],
        inputs: PublicationInput[] = []
      for (const o of unit.operations) {
        if (o.op.op !== 'create') continue
        const op = o.op,
          p = this.pastes.find(
            (p) => !p.done && !p.cancelled && p.assetPath === op.path && p.assetSha === op.sha
          )
        if (!p || !nativeAssetEligible(op.path, this.options.configurationRoots?.())) continue
        if (p.assetHandle && p.assetHandle !== o.handle)
          throw new Error('Native local-create handle changed')
        p.assetHandle = o.handle
        await this.save()
        if (!p.current || !p.sponsor || p.current.sha !== p.sponsor.sha) {
          holds.push(o.index)
          continue
        }
        const old = new Set(p.baseline.facts.map((f) => normalizedSpelling(f.spelling))),
          note = p.sponsor,
          observation = p.current,
          facts = copy(observation.facts).map((f) => ({
            ...f,
            ...(!old.has(normalizedSpelling(f.spelling)) &&
            nativePasteIntroduction(p.before, p.start, p.end, observation.source, p.assetPath, f)
              ? {
                  provenance: {
                    linkId: p.id + ':' + f.start,
                    origin: 'owner-added' as const,
                    noteId: note.fileId,
                    sourceSha: observation.sha,
                    cacheGeneration: observation.generation,
                    proofId: p.id,
                  },
                }
              : {}),
          })),
          current: CompleteSnapshot = {
            kind: 'complete',
            binding: this.options.binding,
            noteId: note.fileId,
            versionId: note.versionId,
            sha: observation.sha,
            origin: 'push',
            facts,
            evidence: {
              adapter: 'obsidian-changed',
              runtime: 'desktop',
              generation: observation.generation,
              noteId: note.fileId,
              versionId: note.versionId,
              sourceSha: observation.sha,
              cacheSha: observation.cacheSha,
              cacheJson: observation.cacheJson,
              complete: true,
            },
          }
        const audiences = []
        for (const grantId of this.options.grants) {
          const v = await this.assets.read(grantId),
            proof = await this.assets.sponsorProof(grantId, note.fileId)
          if (proof.versionId !== note.versionId)
            throw new Error('Native sponsor proof advanced beyond captured cache')
          audiences.push({
            grantId,
            active: v.active,
            sponsorId: note.fileId,
            admissionGeneration: proof.admissionGeneration,
            publicationGeneration: 0,
            withdrawalGeneration: v.withdrawalGeneration,
            alreadyShared: false,
            withdrawn: false,
          })
        }
        inputs.push({
          binding: this.options.binding,
          baseline: p.baseline,
          current,
          owner: {
            kind: 'owner-edit',
            noteId: note.fileId,
            sourceSha: current.sha,
            cacheGeneration: observation.generation,
            baseVersionId: p.baseline.versionId,
            baseCreateHandle: p.id,
          },
          target: {
            id: null,
            versionId: null,
            path: op.path,
            sha: op.sha,
            security: 'eligible',
            creator: 'pending-local-create',
            create: {
              handle: o.handle,
              installation: this.options.binding.localVault,
              pending: true,
              hasLedgerIdentity: false,
            },
          },
          audiences,
          knownRenames: { complete: true, items: [] },
          decisions: [],
        })
      }
      if (inputs.length) {
        // The reviewed core submits this filtered subset under the original request key,
        // WITHOUT calling the hook again. Persist its exact body/renumbered handle map now.
        const sending = unit.operations.filter((o) => !holds.includes(o.index)),
          ops = sending.map((o) => copy(o.op)),
          handles = Object.fromEntries(
            sending.flatMap((o, index) => (o.op.op === 'create' ? [[index, o.handle]] : []))
          )
        await this.persisted('unit:' + unit.idempotencyKey, { ops, handles })
        await this.intents.prepare(
          { requestId: unit.idempotencyKey, ops, createHandles: handles },
          inputs
        )
      }
      if (holds.length) return { holdIndices: holds }
    },
    onSettled: async (item, bytes, id) => {
      this.check()
      await this.work
      if (item.op.op === 'move') {
        const previous = await this.options.state.byFileId(item.fileId)
        if (previous && previous.path !== item.path)
          await this.snapshots.rename(item.fileId, previous.path, item.path)
      }
      if (item.path.endsWith('.md') && bytes && item.sha) {
        const raw = await this.read<LocalLinkUnit | Record<string, LinkFact[]>>('link-unit:' + id)
        // Previously prepared requests stored only the fact map; they cannot acquire create proof.
        const local: LocalLinkUnit | null =
          raw &&
          ('localCreates' in raw && 'facts' in raw && !Array.isArray(raw.facts)
            ? (raw as LocalLinkUnit)
            : { facts: raw as Record<string, LinkFact[]>, localCreates: [] })
        const baseline: Awaited<ReturnType<LinkSnapshotStore['get']>> | LocalNoteBase =
          item.op.op === 'create' &&
          item.creation === 'novel' &&
          local?.localCreates.includes(item.handle)
            ? this.localBase(item.fileId, item.handle)
            : await this.snapshots.get(item.fileId)
        const renames = await this.snapshots.renames()
        const targets = existingPrivateTargets(
          baseline,
          local?.facts[item.handle] ?? [],
          renames.items
        )
        // Preserve questions BEFORE replacing the immutable last-synced baseline.
        await this.queue(async () => {
          const waiting = (await this.read<Record<string, ReceivedBase>>('received-bases')) ?? {}
          if (waiting[item.fileId]) {
            delete waiting[item.fileId]
            await this.persisted('received-bases', waiting)
          }
          await this.preserveCandidates(item.fileId, targets)
          const delayed =
            local?.delayed?.[item.handle] ??
            (baseline.kind === 'local-create' && local?.facts[item.handle]?.some((f) => !f.targetId)
              ? { sha: item.op.op === 'create' ? item.op.sha : item.sha!, baseline }
              : undefined)
          if (delayed) {
            const pending =
              (await this.read<Record<string, DelayedLocalLinks>>('delayed-local-links')) ?? {}
            pending[item.fileId] = {
              path: item.path,
              sourceSha: delayed.sha,
              settledSha: item.sha!,
              versionId: item.versionId,
              baseline: delayed.baseline,
              applied: item.result.status === 'applied',
            }
            await this.persisted('delayed-local-links', pending)
            const arrived = this.observations.get(item.path)
            if (arrived?.sha === delayed.sha) await this.recoverLocalLinks(item.path, arrived)
          }
        })
        const o = await this.exactCache(item.path, item.sha)
        if (o) {
          await this.settleObservation(
            item.fileId,
            item.versionId,
            o,
            item.result.status === 'applied' ? 'push' : 'merge'
          )
          if (item.result.status === 'applied')
            for (const p of this.pastes.filter(
              (p) => !p.done && p.notePath === item.path && p.current?.sha === item.sha
            ))
              p.sponsor = { fileId: item.fileId, versionId: item.versionId, sha: item.sha }
          await this.save()
        } else {
          await this.queue(async () => {
            const arrived = this.observations.get(item.path)
            if (arrived?.sha === item.sha) {
              if (baseline.kind === 'local-create')
                await this.preserveCandidates(
                  item.fileId,
                  existingPrivateTargets(baseline, arrived.facts, renames.items)
                )
              await this.settleObservation(
                item.fileId,
                item.versionId,
                arrived,
                item.result.status === 'applied' ? 'push' : 'merge'
              )
              return
            }
            if (baseline.kind === 'local-create') {
              const waiting =
                (await this.read<Record<string, ReceivedBase>>('received-bases')) ?? {}
              waiting[item.fileId] = {
                path: item.path,
                versionId: item.versionId,
                sha: item.sha!,
                localCreateHandle: item.handle,
              }
              await this.persisted('received-bases', waiting)
            }
            await this.snapshots.invalidate(item.fileId, 'No exact native callback cache')
          })
        }
        if (local) {
          delete local.facts[item.handle]
          if (local.delayed) delete local.delayed[item.handle]
          local.localCreates = local.localCreates.filter((handle) => handle !== item.handle)
          if (!emptyLocalLinkUnit(local)) await this.persisted('link-unit:' + id, local)
          else await this.options.meta.setMeta(this.prefix + 'link-unit:' + id, null)
        }
      } else {
        // Older binary-only batches persisted empty units. They carry no note lineage,
        // but must be cleared on ordinary non-Markdown settlement as well.
        const local = await this.read('link-unit:' + id)
        if (emptyLocalLinkUnit(local))
          await this.options.meta.setMeta(this.prefix + 'link-unit:' + id, null)
      }
      const p = this.pastes.find((p) => p.assetHandle === item.handle && !p.done)
      if (!p) return
      const raw = await this.read<{ ops: CommitOp[]; body: unknown }>('receipt:' + id),
        unitRaw = await this.read<{ ops: CommitOp[]; handles: Record<number, string> }>(
          'unit:' + id
        )
      if (!raw || !unitRaw) throw new Error('Exact native owner unit receipt missing')
      const wire = raw,
        body = CommitResponseSchema.parse(wire.body),
        unit = unitRaw
      if (JSON.stringify(unit.ops) !== JSON.stringify(wire.ops))
        throw new Error('Native owner receipt body changed')
      await this.intents.settle({ requestId: id, ops: wire.ops, outcomes: project(wire.ops, body) })
      p.done = true
      await this.save()
    },
  }
  close() {
    this.live = false
    this.unhookPaste?.()
    this.unhookPaste = null
    for (const { target, ref } of this.refs) target.offref(ref)
    this.refs = []
    if (this.originalCommit) this.options.client.commitRaw = this.originalCommit
  }
  diagnostics() {
    return {
      pastes: this.pastes.map((p) => ({
        note: p.notePath,
        asset: p.assetPath,
        ready: !!p.sponsor,
        cancelled: !!p.cancelled,
        done: !!p.done,
      })),
      cacheErrors: this.cacheErrors,
      pasteEvents: this.pasteEvents,
      lastReason: this.lastReason,
      observations: this.observations.size,
    }
  }
}
