import { computed, ref, shallowRef, watch, type WatchStopHandle } from 'vue'
import { Notice, TFile, type App } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { DiscussionIdentityConflict, isDiscussion } from '@/ai/commentIdentity'
import { CommentService } from '@/ai/CommentService'
import type { ChatSession } from '@/ai/ChatSession'
import { parseChatMetadata, serializeMetadata } from '@/ai/ChatLog'
import { AttentionReader } from './AttentionReader'
import { chatCopyPath } from '@/ai/chatCopy'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import type { ChatMetadata } from '@/ai/types'
import { ShellModal } from '@/modal/ShellModal'
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
  private readonly nodes = shallowRef<{ id: string; label: string; expectedNodeId: string }[]>([])
  readonly incomplete = computed(
    () =>
      this.localIncomplete.value ||
      this.updating.value ||
      this.nodes.value.length > 0 ||
      this.rows.value.some((row) => row.uncertain)
  )
  readonly status = ref('Updating…')
  readonly badge = computed(() => attentionBadge(this.rows.value, this.incomplete.value))
  readonly tooltip = computed(
    () =>
      `Agents · Needs attention: ${this.badge.value.attention}. Working: ${this.badge.value.running}${this.incomplete.value ? ' · Some conversations could not be checked' : ''}`
  )
  private readonly files = new Map<string, AttentionRow>()
  private readonly removed = new Set<string>()
  private readonly revisions = new Map<string, number>()
  /** Only disk-confirmed decisions may subtract from the evidence ledger. */
  private readonly truths = new Map<string, LocalAttention>()
  private savedIndex = ''
  private savedRevisions = ''
  private readonly live = new Map<ChatSession, WatchStopHandle>()
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
          session.currentChatFile,
          session.attention,
          session.pendingToolCalls,
          session.chatTitle,
          session.anchor,
          session.agentId,
          session.activeModelId,
          () => session.kind,
        ],
        () => this.publish(),
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
      title: metadata.title || path.split('/').pop() || 'Chat',
      agent: AgentRegistry.getInstance().get(metadata.agentId ?? '')?.name || 'Agent',
      source: isDiscussion(metadata) ? `Discussion · ${metadata.anchor?.note ?? ''}` : 'Chat',
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
      ...(reason.kind === 'error' && !reason.text ? { text: 'Error details were not saved.' } : {}),
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
    for (const session of this.live.keys())
      if (session.currentChatFile.value?.path === path)
        session.applyAttentionTruth({ ...metadata, attention: truth }, reconcileRequests)
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
    this.status.value = 'Some conversations could not be checked. Open them to check their status.'
  }
  /** Old tool-result records are positive resolutions too; absence of a call is not. */
  private async inspect(
    file: TFile
  ): Promise<{ metadata: ChatMetadata; committed: boolean } | null> {
    const app = GlobalStore.getInstance().app
    const yieldControl = async () => {
      await attentionIdle()
      if (this.disposed) throw new Error('Attention discovery stopped')
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
    for (const node of this.nodes.value)
      rows.set(`node-coverage:${node.id}`, {
        key: `node-coverage:${node.id}`,
        reference: {
          kind: 'node',
          registrationId: node.id,
          nodeId: node.expectedNodeId,
          sessionId: '',
        },
        title: node.label,
        agent: 'Node',
        source: `Node · ${node.label}`,
        reasons: [
          {
            kind: 'delivery',
            id: `node-coverage:${node.id}`,
            at: 0,
            text: "Can't load this node's sessions right now",
          },
        ],
      })
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
                text: 'Saving your decision…',
              }
            : reason
      )
      rows.set(row.key, {
        ...row,
        reasons,
        uncertain: row.uncertain || reasons.some((r) => r.uncertain),
      })
    }
    this.rows.value = sortAttention([...rows.values()].filter((r) => r.reasons.length))
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
        this.status.value = 'Could not save the agents list'
      }
    }
  }
  async start(): Promise<void> {
    if (this.disposed) return
    if (this.started) return this.refresh()
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
            agent: 'Agent',
            source: 'Updating…',
            reasons: reconcileAttentionReasons(entry.reasons, this.files.get(path)?.reasons ?? []),
          })
        }
    } catch {
      this.status.value = 'Could not read the agents list'
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
  refresh(force = true): Promise<void> {
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
              row.reference.kind === 'local' && row.reference.commentId ? 'Discussion' : 'Chat',
            reasons: row.reasons.map((reason) => ({
              ...reason,
              ...(reason.kind === 'running' ? { kind: 'interrupted' as const } : {}),
              uncertain: false,
              ...(reason.kind === 'error'
                ? { text: 'Open the conversation for error details.' }
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
    this.localIncomplete.value = failed
    this.status.value = failed
      ? 'Some conversations could not be read. Open them to check their status.'
      : ''
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
    this.nodes.value = nodes
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

  async markSeen(row: AttentionRow, id: string): Promise<void> {
    if (row.reference.kind !== 'local') return
    const { app } = GlobalStore.getInstance()
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
          if (!metadata) throw new Error('Conversation unavailable')
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
            throw new Error('Conversation opened. Try again.')
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
    if (row.reference.kind !== 'local') return false
    const ref = row.reference
    if (!ref.path && ref.sessionId) {
      const session = chats.getSession(ref.sessionId)
      if (!session) {
        new Notice('Conversation is no longer available')
        return false
      }
      const current = chats.contextualOpenGuard(session)
      if (!chats.adoptSession(session, current)) return false
      await chats.revealSidebar({ focus: false, current })
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
      new Notice('Conversation is no longer available')
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
      if (current?.uncertain)
        new Notice('Could not confirm the current status. Opened the saved conversation.')
      // Opening is read-only. Missing index evidence is not recreated into the conversation.
      if (!current?.reasons.some((r) => r.id === reason.id))
        new Notice('Already answered or request no longer active')
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
      chats.tabOrder.value.map((id) => ({
        id,
        label: chats.getPresentation(id)?.label.value || 'Chat',
      })),
      (id) => chats.closeTab(id)
    )
  }
  private destroy(): void {
    this.disposed = true
    this.reader.destroy()
    if (this.changeTimer !== undefined) window.clearTimeout(this.changeTimer)
    this.pending.clear()
    this.updating.value = false
    for (const stop of this.live.values()) stop()
    this.live.clear()
  }
}

/** The full-tab choice is explicit; dismissal never closes a conversation. */
export function chooseAttentionTab(
  app: App,
  tabs: { id: string; label: string }[],
  close: (id: string) => Promise<void>
): Promise<boolean> {
  return new Promise((resolve) => {
    let chosen = false
    const modal = new (class extends ShellModal {
      onClose(): void {
        super.onClose()
        if (!chosen) resolve(false)
      }
    })(app, {
      title: 'Choose a tab to close',
      size: 'tall',
      cls: ['abele-agents-tabs'],
    })
    modal.bodyEl.createEl('p', {
      text: 'All 20 tabs are open. Only the tab you choose will close.',
    })
    for (const tab of tabs) {
      const button = modal.bodyEl.createEl('button', { text: tab.label })
      button.addEventListener('click', () => {
        button.disabled = true
        void close(tab.id).then(
          () => {
            chosen = true
            modal.close()
            resolve(true)
          },
          (error) => {
            button.disabled = false
            new Notice(error instanceof Error ? error.message : 'Could not close the tab')
          }
        )
      })
    }
    modal.open()
  })
}
