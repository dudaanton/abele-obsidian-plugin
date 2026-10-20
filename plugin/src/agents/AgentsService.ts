import { UiError, uiMessage } from '@/i18n/streamBErrors'
import { streamBDate } from '@/i18n/streamBDate'
import { agentText } from '@/i18n/streamBText'
import { t } from '@/i18n'
import { computed, ref, shallowRef, watch, type WatchStopHandle } from 'vue'
import dayjs from 'dayjs'
import { Notice, SuggestModal, TFile, setTooltip, type App } from 'obsidian'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { DiscussionIdentityConflict, isDiscussion } from '@/ai/commentIdentity'
import { CommentService } from '@/ai/CommentService'
import type { ChatSession } from '@/ai/ChatSession'
import { parseChatMetadata, serializeMetadata } from '@/ai/ChatLog'
import { AttentionReader } from './AttentionReader'
import { NodeAttentionWatch } from './NodeAttentionWatch'
import { delegationAttentionRows, type NodeAttentionTarget } from './nodeAttention'
import type { DelegationCard } from '@/node/delegation'
import { chatCopyPath } from '@/ai/chatCopy'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import type { ChatMetadata } from '@/ai/types'
import {
  attentionBadge,
  attentionReasons,
  restoreIndexedErrors,
  reconcileAttentionReasons,
  settledAttention,
  mergeAttentionTruth,
  sortAttention,
  type LocalAttention,
  type AttentionRow,
  type AttentionReason,
} from './attention'

const INDEX_KEY = 'abele-agents-index'
const REVISIONS_KEY = 'abele-agents-revisions-v1'
const STARTED_AT_KEY = 'abele-agents-started-at'
type CheckedRevision = {
  mtime: number
  size: number
  resolved: string[]
  tools?: LocalAttention['tools']
  reasons: string
  discussion: boolean
}
const indexReasons = (reasons: AttentionReason[]) =>
  reasons.map(({ kind, id, at, target, expires }) => ({ kind, id, at, target, expires }))

function attentionIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function')
      window.requestIdleCallback(() => resolve(), { timeout: 100 })
    else window.setTimeout(resolve, 0)
  })
}
/** Obsidian adapter. The file remains authoritative; the local index never contains a transcript. */
export class AgentsService {
  private static instance: AgentsService | null = null
  static getInstance(): AgentsService {
    return (this.instance ??= new AgentsService())
  }
  static destroyCurrent(): void {
    this.instance?.destroy()
    this.instance = null
  }
  readonly rows = shallowRef<AttentionRow[]>([])
  private readonly localIncomplete = ref(true)
  private readonly updating = ref(false)
  private readonly nodesIncomplete = ref(false)
  private readonly nodeWatch = new NodeAttentionWatch(() => {
    this.nodesIncomplete.value = this.nodeWatch.incomplete
    this.publish()
  })
  readonly incomplete = computed(
    () =>
      this.localIncomplete.value ||
      this.updating.value ||
      this.nodesIncomplete.value ||
      this.rows.value.some((row) => row.uncertain)
  )
  readonly status = ref(t('streamB.updating.dfe40e'))
  readonly badge = computed(() => attentionBadge(this.rows.value, this.incomplete.value))
  readonly tooltip = computed(() =>
    t('streamB.agentsNeedsAttentionWorking.1e76e0', {
      v0: String(this.badge.value.attention),
      v1: String(this.badge.value.running),
      v2: String(
        this.incomplete.value ? t('streamB.someConversationsCouldNotBeChecked.0f3db0') : ''
      ),
    })
  )
  private readonly files = new Map<string, AttentionRow>()
  private readonly removed = new Set<string>()
  private readonly revisions = new Map<string, number>()
  /** Only disk-confirmed decisions may subtract from the evidence ledger. */
  private readonly truths = new Map<string, LocalAttention>()
  private applyingDisk = false
  private savedIndex = ''
  private savedRevisions = ''
  private readonly live = new Map<ChatSession, WatchStopHandle>()
  private delegationNodes: NodeAttentionTarget[] = []
  private readonly nodeDelegations = new Map<string, Record<string, DelegationCard[]>>()

  setDelegations(node: string, cards: Record<string, DelegationCard[]>): void {
    this.nodeDelegations.set(node, cards)
    this.publish()
  }
  private startedAt?: number
  private started = false
  private disposed = false
  private refreshing?: Promise<void>
  private readonly reader = new AttentionReader()
  private readonly checked = new Map<string, CheckedRevision>()
  private readonly pending = new Map<string, { file: TFile; after: number }>()
  private changeTimer?: number
  private draining = false
  private drainingTask?: Promise<void>

  /** Startup create events are inventory, not work. Later sync/stream bursts get one trailing read. */
  scheduleFile(file: TFile): void {
    if (!this.started || this.disposed) return
    const path = file.path
    this.removed.delete(path)
    this.checked.delete(path)
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1)
    this.pending.set(path, { file, after: Date.now() + 250 })
    this.updating.value = true
    this.schedulePending()
  }
  private schedulePending(): void {
    if (this.disposed || this.draining || this.changeTimer !== undefined || !this.pending.size)
      return
    let after = Infinity
    for (const entry of this.pending.values()) after = Math.min(after, entry.after)
    this.changeTimer = window.setTimeout(
      () => {
        this.changeTimer = undefined
        this.drainingTask = this.drainPending().finally(() => {
          this.drainingTask = undefined
        })
      },
      Math.max(0, after - Date.now())
    )
  }
  private async drainPending(): Promise<void> {
    this.draining = true
    try {
      // The initial scan owns the reader until it has finished, even if sync arrives meanwhile.
      await this.refreshing
      for (const [path, entry] of this.pending) {
        if (this.disposed) return
        if (entry.after > Date.now()) continue
        this.pending.delete(path)
        if (entry.file.path !== path || this.removed.has(path) || this.isChecked(entry.file))
          continue
        await attentionIdle()
        if (!this.disposed && !this.removed.has(path) && entry.file.path === path)
          await this.updateFile(entry.file)
      }
    } finally {
      this.draining = false
      this.updating.value = this.pending.size > 0
      this.schedulePending()
    }
  }
  private isChecked(file: TFile): boolean {
    const checked = this.checked.get(file.path)
    return (
      !!checked &&
      checked.mtime === file.stat.mtime &&
      checked.size === file.stat.size &&
      checked.reasons === JSON.stringify(indexReasons(this.files.get(file.path)?.reasons ?? []))
    )
  }
  private rememberRevision(file: TFile): void {
    const row = this.files.get(file.path)
    if (row?.uncertain) return
    this.checked.set(file.path, {
      mtime: file.stat.mtime,
      size: file.stat.size,
      resolved: [...settledAttention(this.truths.get(file.path) ?? {})],
      tools: this.truths.get(file.path)?.tools,
      reasons: JSON.stringify(indexReasons(row?.reasons ?? [])),
      discussion: row?.reference.kind === 'local' && !!row.reference.commentId,
    })
  }

  track(session: ChatSession): void {
    this.live.set(
      session,
      watch(
        [
          // A TFile reaches the vault and app graph even through a shallowRef. Only its
          // path belongs in this deep watch; the remaining sources are plain session data.
          () => session.currentChatFile.value?.path,
          session.attention,
          session.pendingToolCalls,
          session.chatTitle,
          session.anchor,
          session.agentId,
          session.activeModelId,
          () => session.kind,
        ],
        () => {
          if (!this.applyingDisk) this.publish()
        },
        { deep: true, flush: 'sync' }
      )
    )
    this.publish()
  }
  untrack(session: ChatSession): void {
    // Capture before destroy clears its references. Closing is not acknowledgement.
    const row = this.liveRow(session, false)
    if (row)
      this.files.set(row.key, {
        ...row,
        reasons: row.reasons.map((r) => (r.kind === 'running' ? { ...r, kind: 'interrupted' } : r)),
      })
    this.live.get(session)?.()
    this.live.delete(session)
    this.publish()
  }
  private metadataRow(path: string, metadata: ChatMetadata, live: boolean): AttentionRow {
    return {
      key: path,
      reference: {
        kind: 'local',
        path,
        ...(isDiscussion(metadata) && metadata.commentId ? { commentId: metadata.commentId } : {}),
      },
      title: metadata.title || path.split('/').pop() || t('streamB.chat.460b3a'),
      agent:
        AgentRegistry.getInstance().get(metadata.agentId ?? '')?.name || t('streamB.agent.11b39c'),
      source: isDiscussion(metadata)
        ? t('streamB.discussion.c5d2c7', { v0: String(metadata.anchor?.note ?? '') })
        : t('streamB.chat.460b3a'),
      model: metadata.modelId || AgentRegistry.getInstance().get(metadata.agentId ?? '')?.modelId,
      folder: (metadata.anchor?.note || path).split('/').slice(0, -1).join('/') || '/',
      quote: metadata.anchor?.quote,
      reasons: attentionReasons(metadata.attention ?? {}, metadata.pendingToolCalls ?? [], live),
    }
  }
  private fileRow(path: string, metadata: ChatMetadata, live = false): AttentionRow {
    const row = this.metadataRow(path, metadata, live)
    row.reasons = reconcileAttentionReasons(
      this.files.get(path)?.reasons ?? [],
      row.reasons,
      this.truths.get(path)
    ).map((reason) => ({
      ...reason,
      ...(reason.kind === 'error' && !reason.text
        ? { text: agentText('streamB.errorDetailsWereNotSaved.7381e0') }
        : {}),
      ...(!live && reason.kind === 'running' ? { kind: 'interrupted' as const } : {}),
    }))
    row.uncertain =
      row.reasons.some((reason) => reason.uncertain) ||
      row.reasons.some(
        (reason) =>
          !attentionReasons(metadata.attention ?? {}, metadata.pendingToolCalls ?? [], live).some(
            (current) => current.id === reason.id
          )
      )
    return row
  }
  private acceptDisk(path: string, metadata: ChatMetadata, reconcileRequests = true): void {
    const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) CommentService.getInstance().rememberFile(file, metadata)
    const truth = mergeAttentionTruth(metadata.attention ?? {}, this.truths.get(path) ?? {})
    this.truths.set(path, truth)
    this.files.set(path, this.fileRow(path, { ...metadata, attention: truth }))
    // The caller publishes the completed disk batch. Applying truth can update several
    // watched refs per holder; none should rebuild/sort/persist the entire list mid-batch.
    const applyingDisk = this.applyingDisk
    this.applyingDisk = true
    try {
      for (const session of this.live.keys())
        if (session.currentChatFile.value?.path === path)
          session.applyAttentionTruth({ ...metadata, attention: truth }, reconcileRequests)
    } finally {
      this.applyingDisk = applyingDisk
    }
  }
  private unknown(path: string): void {
    this.checked.delete(path)
    const row = this.files.get(path)
    if (row)
      this.files.set(path, {
        ...row,
        uncertain: true,
        reasons: row.reasons.map((r) => ({ ...r, uncertain: true })),
      })
    this.localIncomplete.value = true
    this.status.value = t('streamB.someConversationsCouldNotBeCheckedOpen.dcc424')
  }
  /** Old tool-result records are positive resolutions too; absence of a call is not. */
  private async inspect(
    file: TFile
  ): Promise<{ metadata: ChatMetadata; committed: boolean } | null> {
    const app = GlobalStore.getInstance().app
    const yieldControl = async () => {
      await attentionIdle()
      if (this.disposed) throw new UiError(uiMessage('streamB.attentionDiscoveryStopped.fc2dc9'))
    }
    const text = await app.vault.read(file)
    let parsed = await this.reader.read(text, yieldControl)
    const main = !!parsed.metadata && !parsed.damaged && !parsed.torn
    let committed = main
    if (!main) {
      const copyPath = chatCopyPath(app, file.path)
      if (await app.vault.adapter.exists(copyPath)) {
        const raw = await app.vault.adapter.read(copyPath)
        const cut = raw.indexOf('\n')
        if (cut !== -1 && raw.slice(0, cut) === file.path) {
          const copy = await this.reader.read(raw.slice(cut + 1), yieldControl)
          if (copy.version === 2 && !copy.torn && !copy.damaged && copy.records >= parsed.records)
            parsed = copy
        }
      }
    }
    // Ordinary chats do not need discussion identity migration, recovery or repeated full reads.
    if (main && isDiscussion(parsed.metadata)) {
      try {
        const initial = parsed
        parsed = await ChatStorage.getInstance().prepareDiscussionAttention(file, (content) =>
          content === text ? Promise.resolve(initial) : this.reader.read(content, yieldControl)
        )
      } catch (error) {
        if (!(error instanceof DiscussionIdentityConflict)) throw error
        // Identity is unresolved, not the stored attention evidence. Keep it visible as
        // incomplete, without granting an ID or accepting disk resolutions as settled truth.
        committed = false
        if (parsed.metadata)
          parsed = {
            ...parsed,
            metadata: { ...parsed.metadata, commentId: undefined, commentLocation: undefined },
          }
      }
    }
    if (!parsed.metadata || parsed.damaged || parsed.torn) return null
    return { metadata: parsed.metadata, committed }
  }
  private liveRow(session: ChatSession, live = true): AttentionRow | null {
    const path = session.currentChatFile.value?.path ?? ''
    if ((!live && !path) || this.removed.has(path) || session.isDestroyed || session.kind === 'run')
      return null
    const row = this.fileRow(
      path,
      {
        type: 'abele-chat',
        providerId: '',
        modelId: session.activeModelId.value,
        created: '',
        kind: session.kind === 'comment' ? 'comment' : 'chat',
        anchor: session.anchor.value ?? undefined,
        title: session.chatTitle.value,
        agentId: session.agentId.value,
        attention: session.attention.value,
        commentId: session.commentId ?? undefined,
        pendingToolCalls: session.pendingToolCalls.value,
      },
      live
    )
    if (!path) {
      row.key = `live:${session.id}`
      row.reference = { kind: 'local', path: '', sessionId: session.id }
    }
    const children = session.delegationParentId
      ? [...this.nodeDelegations.values()].flatMap(
          (parents) => parents[session.delegationParentId!] ?? []
        )
      : []
    if (!row.reasons.length && children.length)
      row.reasons.push({
        kind: children.some((child) => child.state === 'running') ? 'running' : 'done',
        id: 'node-developers',
        at: 0,
      })
    return row
  }
  private publish(): void {
    if (this.disposed) return
    // Add live arrivals to the ledger, but never retire an entry from a transient view.
    const liveRows = new Map<string, AttentionRow>()
    for (const session of this.live.keys()) {
      const row = this.liveRow(session)
      if (!row) continue
      if (row.reference.kind === 'local' && row.reference.path) this.files.set(row.key, row)
      liveRows.set(row.key, row)
    }
    const rows = new Map(this.files)
    for (const row of this.nodeWatch.rows()) rows.set(row.key, row)
    for (const node of this.delegationNodes) {
      const parents = this.nodeDelegations.get(node.expectedNodeId)
      if (parents)
        for (const row of delegationAttentionRows(Object.values(parents).flat(), node))
          rows.set(row.key, row)
    }
    for (const session of this.live.keys()) {
      const row = liveRows.get(session.currentChatFile.value?.path ?? `live:${session.id}`)
      if (!row) continue
      // An accepted tool can already be executing while its decision write is pending.
      const localSettled = settledAttention(session.attention.value)
      const diskSettled = settledAttention(this.truths.get(row.key) ?? {})
      const reasons = row.reasons.map((reason) =>
        session.attention.value.tools?.[reason.id] === 'executing'
          ? { ...reason, kind: 'running' as const, uncertain: false }
          : localSettled.has(reason.id) && !diskSettled.has(reason.id)
            ? {
                ...reason,
                kind: 'delivery' as const,
                uncertain: true,
                text: t('streamB.savingYourDecision.237a47'),
              }
            : reason
      )
      rows.set(row.key, {
        ...row,
        reasons,
        uncertain: row.uncertain || reasons.some((r) => r.uncertain),
      })
    }
    // Baseline historical notifications, not live requests or coverage failures. Keep the
    // evidence ledger intact: a cutoff is a local viewing decision, not a disk resolution.
    this.rows.value = sortAttention(
      [...rows.values()]
        .map((row) => ({
          ...row,
          reasons: row.reasons.filter(
            (reason) =>
              this.startedAt === undefined ||
              !['error', 'interrupted'].includes(reason.kind) ||
              reason.at >= this.startedAt
          ),
        }))
        .filter((row) => row.reasons.length)
    )
    if (this.started) {
      try {
        const index = [...this.files.values()]
          .filter(
            (row) => row.reference.kind === 'local' && !!row.reference.path && row.reasons.length
          )
          .map((row) => ({
            reference: row.reference,
            reasons: indexReasons(row.reasons),
          }))
        const encoded = JSON.stringify(index)
        if (encoded !== this.savedIndex) {
          GlobalStore.getInstance().app.saveLocalStorage(INDEX_KEY, index)
          this.savedIndex = encoded
        }
        // Keep revision hints separate from the evidence ledger, including chats with no work.
        // No title, quote, tool arguments, error text or transcript is stored here.
        const revisions = [...this.checked]
        const encodedRevisions = JSON.stringify(revisions)
        if (encodedRevisions !== this.savedRevisions) {
          GlobalStore.getInstance().app.saveLocalStorage(REVISIONS_KEY, revisions)
          this.savedRevisions = encodedRevisions
        }
      } catch {
        this.localIncomplete.value = true
        this.status.value = t('streamB.couldNotSaveTheAgentsList.f7f148')
      }
    }
  }
  async start(): Promise<void> {
    if (this.disposed) return
    if (this.started) return this.refresh()
    // Written once, including upgrades that already have an index but no baseline.
    // If storage fails, retain evidence and incomplete coverage rather than invent a cutoff.
    try {
      const app = GlobalStore.getInstance().app
      const stored = app.loadLocalStorage(STARTED_AT_KEY)
      if (typeof stored === 'number' && Number.isFinite(stored) && stored >= 0)
        this.startedAt = stored
      else {
        const now = Date.now()
        app.saveLocalStorage(STARTED_AT_KEY, now)
        this.startedAt = now
      }
    } catch {
      this.status.value = t('streamB.couldNotSaveTheAgentsListBaseline.e22210')
    }
    // Load durable evidence before enabling any publication, including node registry changes.
    // The last local copy is explicitly incomplete until the authoritative files are read.
    try {
      const stored = GlobalStore.getInstance().app.loadLocalStorage(INDEX_KEY)
      if (Array.isArray(stored))
        for (const entry of stored) {
          if (
            entry?.reference?.kind !== 'local' ||
            typeof entry.reference.path !== 'string' ||
            !Array.isArray(entry.reasons)
          )
            continue
          const path = entry.reference.path
          this.files.set(path, {
            key: path,
            reference: entry.reference,
            title: path.split('/').pop()!,
            agent: t('streamB.agent.11b39c'),
            source: t('streamB.updating.dfe40e'),
            reasons: reconcileAttentionReasons(
              entry.reasons.map((reason: AttentionReason) =>
                reason.kind === 'running' ? { ...reason, kind: 'interrupted' } : reason
              ),
              this.files.get(path)?.reasons ?? []
            ),
          })
        }
    } catch {
      this.status.value = t('streamB.couldNotReadTheAgentsList.9dbd89')
    }
    try {
      const stored = GlobalStore.getInstance().app.loadLocalStorage(REVISIONS_KEY)
      if (Array.isArray(stored))
        for (const entry of stored) {
          if (!Array.isArray(entry) || entry.length !== 2) continue
          const [path, revision] = entry
          if (
            typeof path !== 'string' ||
            !Number.isFinite(revision?.mtime) ||
            !Number.isFinite(revision?.size) ||
            typeof revision?.reasons !== 'string' ||
            typeof revision?.discussion !== 'boolean' ||
            (revision.tools !== undefined &&
              (!revision.tools ||
                typeof revision.tools !== 'object' ||
                Object.values(revision.tools).some(
                  (phase) => phase !== 'executing' && phase !== 'interrupted' && phase !== 'done'
                ))) ||
            !Array.isArray(revision?.resolved) ||
            !revision.resolved.every((id: unknown) => typeof id === 'string')
          )
            continue
          this.checked.set(path, revision)
          this.truths.set(path, { resolved: revision.resolved, tools: revision.tools })
        }
    } catch {
      /* Missing or invalid hints mean a cold inventory, never lost evidence. */
    }
    // A changed inventory can introduce a second discussion owner. Never reuse ownership
    // across that boundary; the existing identity gate must resolve it again.
    const inventory = GlobalStore.getInstance()
      .app.vault.getFiles()
      .filter((f) => f.extension === 'abchat')
    if (inventory.length !== this.checked.size || inventory.some((file) => !this.isChecked(file)))
      for (const [path, revision] of this.checked)
        if (revision.discussion) this.checked.delete(path)
    const registered = GlobalStore.getInstance().app.loadLocalStorage('abele-node-registry')
    if (Array.isArray(registered))
      this.setNodes(
        registered.filter(
          (n) =>
            typeof n?.id === 'string' &&
            typeof n?.label === 'string' &&
            typeof n?.expectedNodeId === 'string'
        )
      )
    this.started = true
    this.publish()
    await this.refresh(false)
  }
  /** Ask the connected nodes again, without rereading the vault's chats. */
  refreshNodes(): Promise<void> {
    return this.nodeWatch.refresh()
  }
  refresh(force = true): Promise<void> {
    if (force) void this.nodeWatch.refresh()
    if (this.refreshing !== undefined) return this.refreshing
    const scan =
      this.drainingTask !== undefined
        ? this.drainingTask.then(() => this.scan(force))
        : this.scan(force)
    this.refreshing = scan.finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }
  private async scan(force: boolean): Promise<void> {
    const { app } = GlobalStore.getInstance()
    let failed = false
    for (const file of app.vault.getFiles().filter((f) => f.extension === 'abchat')) {
      if (this.disposed) return
      if (!force && this.isChecked(file)) {
        const row = this.files.get(file.path)
        if (row)
          this.files.set(file.path, {
            ...row,
            source:
              row.reference.kind === 'local' && row.reference.commentId
                ? t('streamB.discussion.5eb6cf')
                : t('streamB.chat.460b3a'),
            reasons: row.reasons.map((reason) => ({
              ...reason,
              ...(reason.kind === 'running' ? { kind: 'interrupted' as const } : {}),
              uncertain: false,
              ...(reason.kind === 'error'
                ? { text: agentText('streamB.openTheConversationForErrorDetails.43dc40') }
                : {}),
            })),
          })
        continue
      }
      const path = file.path
      const revision = this.revisions.get(path) ?? 0
      try {
        // Yield before the first file too; layout and input have priority over discovery.
        if (!force) await attentionIdle()
        if (this.disposed) return
        const stamp = { ...file.stat }
        const metadata = await this.inspect(file)
        if (this.disposed) return
        if (file.path !== path || (this.revisions.get(path) ?? 0) !== revision) continue
        if (metadata?.metadata.type === 'abele-chat') {
          if (metadata.committed) {
            await this.reconcileDiscussionOwners(file.path, metadata.metadata)
            if (file.path !== path || (this.revisions.get(path) ?? 0) !== revision) continue
            this.acceptDisk(file.path, metadata.metadata)
            if (stamp.mtime === file.stat.mtime && stamp.size === file.stat.size)
              this.rememberRevision(file)
          } else {
            this.files.set(path, this.fileRow(path, metadata.metadata))
            this.unknown(path)
            failed = true
          }
        } else {
          this.unknown(path)
          failed = true
        }
      } catch {
        if ((this.revisions.get(path) ?? 0) === revision) {
          this.unknown(path)
          failed = true
        }
      }
      if (force) await attentionIdle()
    }
    if (this.disposed) return
    const paths = new Set(
      app.vault
        .getFiles()
        .filter((f) => f.extension === 'abchat')
        .map((f) => f.path)
    )
    for (const path of new Set([...this.files.keys(), ...this.checked.keys()]))
      if (!paths.has(path)) this.deleted(path)
    failed ||= this.startedAt === undefined
    this.localIncomplete.value = failed
    this.status.value = failed ? t('streamB.someConversationsCouldNotBeReadOpen.dac81a') : ''
    this.publish()
  }
  /** A changed file costs one read, not a vault scan on every streamed token. */
  async updateFile(file: TFile, oldPath?: string): Promise<void> {
    if (oldPath) ChatStorage.getInstance().noteDiscussionRename(file, oldPath)
    if (oldPath && oldPath !== file.path) {
      // Move the only durable evidence before I/O; never publish a delete-then-rebuild gap.
      const previous = this.files.get(oldPath)
      if (previous)
        this.files.set(file.path, {
          ...previous,
          key: file.path,
          reference: { ...previous.reference, path: file.path } as AttentionRow['reference'],
        })
      const truth = this.truths.get(oldPath)
      if (truth) this.truths.set(file.path, truth)
      this.files.delete(oldPath)
      this.truths.delete(oldPath)
      this.revisions.set(oldPath, (this.revisions.get(oldPath) ?? 0) + 1)
      this.removed.add(oldPath)
      this.publish()
    }
    const path = file.path
    this.checked.delete(path)
    if (oldPath) this.checked.delete(oldPath)
    ChatStorage.getInstance().invalidateDiscussion(path)
    if (oldPath) ChatStorage.getInstance().invalidateDiscussion(oldPath)
    const revision = (this.revisions.get(path) ?? 0) + 1
    this.revisions.set(path, revision)
    this.removed.delete(path)
    try {
      if (oldPath) await CommentService.getInstance().handleConversationRename(file, oldPath)
      const stamp = { ...file.stat }
      const metadata = await this.inspect(file)
      if (this.disposed || file.path !== path || this.revisions.get(path) !== revision) return
      if (metadata?.metadata.type === 'abele-chat') {
        if (metadata.committed) {
          await this.reconcileDiscussionOwners(file.path, metadata.metadata)
          if (this.disposed || file.path !== path || this.revisions.get(path) !== revision) return
          this.acceptDisk(file.path, metadata.metadata)
          if (stamp.mtime === file.stat.mtime && stamp.size === file.stat.size)
            this.rememberRevision(file)
        } else {
          this.files.set(path, this.fileRow(path, metadata.metadata))
          this.unknown(path)
        }
      } else this.unknown(path)
    } catch {
      if (this.revisions.get(path) !== revision) return
      this.unknown(path)
    }
    this.publish()
  }
  private async reconcileDiscussionOwners(path: string, metadata: ChatMetadata): Promise<void> {
    for (const session of this.live.keys()) {
      if (session.currentChatFile.value?.path !== path) continue
      try {
        await session.reconcileDiscussionIdentity(metadata)
      } catch {
        this.unknown(path) /* Storage fences this holder until explicit reconciliation. */
      }
    }
  }

  setNodes(nodes: { id: string; label: string; expectedNodeId: string }[]): void {
    if (this.disposed) return
    this.delegationNodes = nodes
    for (const node of this.nodeDelegations.keys())
      if (!nodes.some((entry) => entry.expectedNodeId === node)) this.nodeDelegations.delete(node)
    this.nodeWatch.set(nodes)
    this.nodesIncomplete.value = this.nodeWatch.incomplete
    this.publish()
  }
  saved(path: string, metadata: ChatMetadata): void {
    this.checked.delete(path)
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1)
    this.acceptDisk(path, metadata, false)
    this.publish()
  }
  deleted(path: string): void {
    this.checked.delete(path)
    this.pending.delete(path)
    ChatStorage.getInstance().invalidateDiscussion(path)
    if (GlobalStore.getInstance().app.vault.getAbstractFileByPath(path)) {
      this.unknown(path)
      this.publish()
      return
    }
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1)
    this.removed.add(path)
    for (const session of [...this.live.keys()]) {
      if (session.currentChatFile.value?.path !== path) continue
      ChatService.getInstance().dropTab(session.id)
      session.destroy()
    }
    this.files.delete(path)
    this.truths.delete(path)
    this.publish()
  }

  /** Foreground presentation also acknowledges indexed failures whose file write was lost. */
  async markChatSeen(session: ChatSession): Promise<void> {
    const path = session.currentChatFile.value?.path
    const reasons = path ? (this.files.get(path)?.reasons ?? []) : []
    await session.markFailuresSeen(reasons.filter((r) => r.kind === 'error').map((r) => r.id))
  }

  /** Snapshot all rows, not just search matches. Live requests and coverage stay visible. */
  async markAllSeen(): Promise<void> {
    const targets = this.rows.value.flatMap((row) =>
      row.reference.kind === 'local'
        ? row.reasons
            .filter((reason) => ['error', 'interrupted'].includes(reason.kind))
            .map((reason) => ({ row, id: reason.id }))
        : []
    )
    let failure: unknown
    for (const { row, id } of targets) {
      try {
        await this.markSeen(row, id)
      } catch (error) {
        failure ??= error
      }
    }
    if (failure) throw failure
  }

  async markSeen(row: AttentionRow, id: string): Promise<void> {
    if (row.reference.kind !== 'local') return
    const { app } = GlobalStore.getInstance()
    const sessionId = row.reference.sessionId
    const unsaved = sessionId && [...this.live.keys()].find((session) => session.id === sessionId)
    if (unsaved) {
      await unsaved.markAttentionSeen(id)
      if (unsaved.currentChatFile.value) await this.updateFile(unsaved.currentChatFile.value)
      else this.publish()
      return
    }
    const file = app.vault.getAbstractFileByPath(row.reference.path)
    if (!(file instanceof TFile)) {
      this.deleted(row.key)
      return
    }
    const open = [...this.live.keys()].find((s) => s.currentChatFile.value?.path === file.path)
    if (open) {
      open.attention.value = {
        ...open.attention.value,
        errors: restoreIndexedErrors(open.attention.value, row.reasons),
      }
      await open.markAttentionSeen(id)
    } else {
      await ChatStorage.getInstance().transformDiscussion(
        file,
        (content) => {
          const metadata = parseChatMetadata(content)
          if (!metadata) throw new UiError(uiMessage('streamB.conversationUnavailable.6117bc'))
          const state = metadata.attention ?? {}
          return (
            content +
            serializeMetadata({
              ...metadata,
              attention: {
                ...state,
                resolved: [...new Set([...(state.resolved ?? []), id])],
                errors: restoreIndexedErrors(state, row.reasons).map((e) =>
                  e.id === id ? { ...e, seen: true } : e
                ),
                run: state.run?.id === id ? { ...state.run, status: 'done' } : state.run,
                question:
                  state.question?.id === id
                    ? { ...state.question, status: 'cancelled' }
                    : state.question,
              },
            })
          )
        },
        () => {
          if ([...this.live.keys()].some((s) => s.currentChatFile.value?.path === file.path))
            throw new UiError(uiMessage('streamB.conversationOpenedTryAgain.bf6557'))
        }
      )
    }
    await this.updateFile(file)
  }
  /** Transport admission only: no new input, retry of a run or approval decision. */
  async reconnect(row: AttentionRow): Promise<void> {
    if (row.reference.kind !== 'node') return
    const { NodeService } = await import('@/node/NodeService')
    await NodeService.getInstance().connection(row.reference.registrationId).connect()
  }
  async open(
    row: AttentionRow,
    reason: AttentionReason,
    options: { focusComposer?: boolean } = {}
  ): Promise<boolean> {
    const chats = ChatService.getInstance()
    if (row.reference.kind === 'node') {
      const { registrationId, nodeId, sessionId } = row.reference
      if (!sessionId) return false
      await chats.openNodeSession({
        kind: 'node-session',
        nodeId,
        registrationId,
        sessionId,
        title: row.title,
      })
      await chats.revealSidebar({ focus: false })
      return true
    }
    const ref = row.reference
    if (!ref.path && ref.sessionId) {
      const session = chats.getSession(ref.sessionId)
      if (!session) {
        new Notice(t('streamB.conversationIsNoLongerAvailable.67047f'))
        return false
      }
      const current = chats.contextualOpenGuard(session)
      if (!chats.adoptSession(session, current)) return false
      await chats.revealSidebar({ focus: false, current })
      if (!chats.isForegroundPresentation(current)) return false
      await this.markChatSeen(session)
      if (!chats.isForegroundPresentation(current)) return false
      if (reason.target) chats.pendingReveal.value = reason.target
      chats.pendingAttentionReveal.value = {
        sessionId: session.id,
        kind: reason.kind,
        id: reason.id,
        focusComposer: options.focusComposer,
      }
      return true
    }
    const existing = [...this.live.keys()].find((s) => s.currentChatFile.value?.path === ref.path)
    const inTab = existing && chats.getSession(existing.id)
    if (!inTab && !chats.canCreateTab && !(await this.chooseTab())) return false
    const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(ref.path)
    if (!(file instanceof TFile)) {
      this.deleted(row.key)
      new Notice(t('streamB.conversationIsNoLongerAvailable.67047f'))
      return false
    }
    const presentationCurrent = chats.fileOpenGuard(file)
    chats.openingSelection.value = true
    try {
      if (ref.commentId) {
        if (!(await CommentService.getInstance().revealForAttention(file, presentationCurrent)))
          return false
      } else {
        await chats.openChatFile(file, presentationCurrent)
        await chats.revealSidebar({ focus: false, current: presentationCurrent })
      }
      const session = chats.activeSession.value
      if (
        !chats.isForegroundPresentation(presentationCurrent) ||
        !session ||
        session.currentChatFile.value?.path !== ref.path
      )
        return false
      await this.updateFile(file)
      if (!session.isMidTurn && !session.attentionBusy)
        await session.reconcileForSelectionReturn(presentationCurrent)
      if (
        !chats.isForegroundPresentation(presentationCurrent) ||
        chats.activeSession.value !== session
      )
        return false
      const current = this.liveRow(session)
      if (current?.uncertain) new Notice(t('streamB.couldNotConfirmTheCurrentStatusOpened.254502'))
      // A foreground opening acknowledges saved failures only, never questions or tools.
      await this.markChatSeen(session)
      if (
        !chats.isForegroundPresentation(presentationCurrent) ||
        chats.activeSession.value !== session
      )
        return false
      // Missing index evidence is not recreated into the conversation.
      if (reason.kind !== 'error' && !current?.reasons.some((r) => r.id === reason.id))
        new Notice(t('streamB.alreadyAnsweredOrRequestNoLongerActive.c589fa'))
      const target =
        reason.target ||
        (reason.kind === 'approval'
          ? session.allMessages.value.find((m) => m.toolCallId === reason.id)?.id
          : undefined)
      if (
        target &&
        (reason.kind === 'running' || !current?.reasons.some((r) => r.id === reason.id))
      )
        chats.pendingReveal.value = target
      chats.pendingAttentionReveal.value = {
        sessionId: session.id,
        kind: reason.kind,
        id: reason.id,
        focusComposer: options.focusComposer,
      }
      return true
    } finally {
      chats.openingSelection.value = false
    }
  }
  private chooseTab(): Promise<boolean> {
    const chats = ChatService.getInstance()
    return chooseAttentionTab(
      GlobalStore.getInstance().app,
      chats.tabOrder.value.map((id) => {
        const local = chats.getSession(id)
        const last = local?.messages.value.at(-1)
        return {
          id,
          label: chats.getPresentation(id)?.label.value || t('streamB.chat.460b3a'),
          waiting:
            !!local && (local.pendingToolCalls.value.length > 0 || !!local.pendingQuestions.value),
          working: !!local?.isStreaming.value,
          at: last?.timestamp,
        }
      }),
      (id) => chats.closeTab(id)
    )
  }
  private destroy(): void {
    this.disposed = true
    this.reader.destroy()
    this.nodeWatch.destroy()
    if (this.changeTimer !== undefined) window.clearTimeout(this.changeTimer)
    this.pending.clear()
    this.updating.value = false
    for (const stop of this.live.values()) stop()
    this.live.clear()
  }
}

/** A chat tab, as the choice of which to close offers it. */
export interface ClosableTab {
  id: string
  label: string
  /** The agent waits for an answer or a permission there. */
  waiting?: boolean
  /** The agent is at work there. */
  working?: boolean
  /** When its last message was written. */
  at?: number
}

/**
 * Every tab is taken: which one to close, picked the way Obsidian's quick switcher picks a
 * note. Quiet chats first and the ones that wait for you or work last, since a quiet one is
 * what you usually let go; a dot says which is which, the time when each last moved. The
 * full-tab choice is explicit: Esc, or a press outside, never closes a conversation.
 */
export function chooseAttentionTab(
  app: App,
  tabs: ClosableTab[],
  close: (id: string) => Promise<void>
): Promise<boolean> {
  const busy = (tab: ClosableTab) => (tab.waiting ? 2 : tab.working ? 1 : 0)
  const order = [...tabs].sort((a, b) => busy(a) - busy(b) || (a.at ?? 0) - (b.at ?? 0))
  return new Promise((resolve) => {
    let picked = false
    const modal = new (class extends SuggestModal<ClosableTab> {
      rows = new SuggestionRows()
      getSuggestions(query: string): ClosableTab[] {
        const q = query.trim().toLowerCase()
        return q ? order.filter((tab) => tab.label.toLowerCase().includes(q)) : order
      }
      renderSuggestion(tab: ClosableTab, el: HTMLElement): void {
        el.classList.add('abele-close-tab__item')
        this.rows.draw(el, {
          title: tab.label,
          aux: [
            ...(tab.at
              ? [
                  {
                    flair: dayjs(tab.at).isSame(dayjs(), 'day')
                      ? streamBDate(dayjs(tab.at), 'HH:mm')
                      : streamBDate(dayjs(tab.at), 'D MMM'),
                    cls: 'abele-close-tab__time',
                  },
                ]
              : []),
            ...(tab.waiting || tab.working
              ? [
                  {
                    dot: tab.waiting
                      ? t('streamB.waitingForYou.9f760a')
                      : t('streamB.theAgentIsWorking.c2556c'),
                    cls: `abele-close-tab__dot ${tab.waiting ? 'abele-close-tab__dot_waiting' : ''}`,
                  },
                ]
              : []),
          ],
        })
      }
      onChooseSuggestion(tab: ClosableTab): void {
        picked = true
        void close(tab.id).then(
          () => resolve(true),
          (error) => {
            new Notice(
              error instanceof Error ? error.message : t('streamB.couldNotCloseTheTab.f9ace0')
            )
            resolve(false)
          }
        )
      }
      onClose(): void {
        super.onClose()
        this.rows.clear()
        // Obsidian closes the list before it hands over the choice: wait that moment out, so
        // only a dismissal resolves here; a choice resolves once its tab is closed.
        window.setTimeout(() => {
          if (!picked) resolve(false)
        }, 0)
      }
    })(app)
    modal.setPlaceholder(t('streamB.closeWhichChat.ab65c6'))
    modal.setInstructions([
      { command: '↑↓', purpose: t('streamB.toChoose.89c0a2') },
      { command: '↵', purpose: t('streamB.toCloseIt.5c8e37') },
      { command: 'esc', purpose: t('streamB.toKeepThemAll.fe39d4') },
    ])
    modal.modalEl.classList.add('abele-close-tab')
    // How full the tabs are, as a code in the field's corner: every one taken.
    const count = modal.inputEl.parentElement?.createSpan({
      cls: 'abele-close-tab__count',
      text: `${tabs.length}/${tabs.length}`,
    })
    if (count)
      setTooltip(count, t('streamB.allChatTabsAreOpen.153ec9', { v0: String(tabs.length) }))
    modal.open()
  })
}
