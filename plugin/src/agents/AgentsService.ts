import { computed, ref, shallowRef, watch, type WatchStopHandle } from 'vue'
import { Notice, TFile, type App } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { DiscussionIdentityConflict, isDiscussion } from '@/ai/commentIdentity'
import { CommentService } from '@/ai/CommentService'
import type { ChatSession } from '@/ai/ChatSession'
import { parseChatMetadata, serializeMetadata } from '@/ai/ChatLog'
import { inspectChat, inspectMainChat } from '@/ai/chatCopy'
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
  private readonly nodes = shallowRef<{ id: string; label: string; expectedNodeId: string }[]>([])
  readonly incomplete = computed(
    () =>
      this.localIncomplete.value ||
      this.nodes.value.length > 0 ||
      this.rows.value.some((row) => row.uncertain)
  )
  readonly status = ref('Обновляется')
  readonly badge = computed(() => attentionBadge(this.rows.value, this.incomplete.value))
  readonly tooltip = computed(
    () =>
      `Агенты · Требуют внимания: ${this.badge.value.attention}. Работают: ${this.badge.value.running}${this.incomplete.value ? ' · Данные неполны' : ''}`
  )
  private readonly files = new Map<string, AttentionRow>()
  private readonly removed = new Set<string>()
  private readonly revisions = new Map<string, number>()
  /** Only disk-confirmed decisions may subtract from the evidence ledger. */
  private readonly truths = new Map<string, LocalAttention>()
  private savedIndex = ''
  private readonly live = new Map<ChatSession, WatchStopHandle>()
  private started = false
  private disposed = false
  private refreshing?: Promise<void>

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
      title: metadata.title || path.split('/').pop() || 'Чат',
      agent: AgentRegistry.getInstance().get(metadata.agentId ?? '')?.name || 'Агент',
      source: isDiscussion(metadata) ? `Обсуждение · ${metadata.anchor?.note ?? ''}` : 'Чат',
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
        ? { text: 'Подробности ошибки не сохранились.' }
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
    for (const session of this.live.keys())
      if (session.currentChatFile.value?.path === path)
        session.applyAttentionTruth({ ...metadata, attention: truth }, reconcileRequests)
  }
  private unknown(path: string): void {
    const row = this.files.get(path)
    if (row)
      this.files.set(path, {
        ...row,
        uncertain: true,
        reasons: row.reasons.map((r) => ({ ...r, uncertain: true })),
      })
    this.localIncomplete.value = true
    this.status.value = 'Не все состояния подтверждены'
  }
  /** Old tool-result records are positive resolutions too; absence of a call is not. */
  private async inspect(
    file: TFile
  ): Promise<{ metadata: ChatMetadata; committed: boolean } | null> {
    const app = GlobalStore.getInstance().app
    const main = await inspectMainChat(app, file)
    let parsed = main ?? (await inspectChat(app, file))
    let committed = main !== null
    if (main) {
      try {
        parsed = (await ChatStorage.getInstance().prepareDiscussion(file)).snapshot
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
    const resolved = parsed.messages
      .filter((m) => m.toolCallId && (m.toolResult !== undefined || m.toolStatus === 'rejected'))
      .map((m) => m.toolCallId!)
    return {
      metadata: {
        ...parsed.metadata,
        attention: {
          ...parsed.metadata.attention,
          resolved: [...new Set([...(parsed.metadata.attention?.resolved ?? []), ...resolved])],
        },
      },
      committed,
    }
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
        modelId: '',
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
            text: 'Сводка всех сессий Node недоступна · Данные неполны',
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
            ? { ...reason, kind: 'delivery' as const, uncertain: true, text: 'Решение сохраняется' }
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
            reasons: row.reasons.map(({ kind, id, at, target, expires }) => ({
              kind,
              id,
              at,
              target,
              expires,
            })),
          }))
        const encoded = JSON.stringify(index)
        if (encoded !== this.savedIndex) {
          GlobalStore.getInstance().app.saveLocalStorage(INDEX_KEY, index)
          this.savedIndex = encoded
        }
      } catch {
        this.localIncomplete.value = true
        this.status.value = 'Не удалось сохранить список'
      }
    }
  }
  async start(): Promise<void> {
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
            agent: 'Агент',
            source: 'Обновляется',
            reasons: reconcileAttentionReasons(entry.reasons, this.files.get(path)?.reasons ?? []),
          })
        }
    } catch {
      this.status.value = 'Не удалось прочитать список'
    }
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
    await this.refresh()
  }
  refresh(): Promise<void> {
    if (this.refreshing !== undefined) return this.refreshing
    this.refreshing = this.scan().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }
  private async scan(): Promise<void> {
    const { app } = GlobalStore.getInstance()
    let failed = false
    for (const file of app.vault.getFiles().filter((f) => f.extension === 'abchat')) {
      const path = file.path
      const revision = this.revisions.get(path) ?? 0
      try {
        const metadata = await this.inspect(file)
        if (this.disposed) return
        if (file.path !== path || (this.revisions.get(path) ?? 0) !== revision) continue
        if (metadata?.metadata.type === 'abele-chat') {
          if (metadata.committed) {
            await this.reconcileDiscussionOwners(file.path, metadata.metadata)
            this.acceptDisk(file.path, metadata.metadata)
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
      // Startup reading yields between files, never instantiates a session or starts a tool.
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
    if (this.disposed) return
    const paths = new Set(
      app.vault
        .getFiles()
        .filter((f) => f.extension === 'abchat')
        .map((f) => f.path)
    )
    for (const path of this.files.keys()) if (!paths.has(path)) this.deleted(path)
    this.localIncomplete.value = failed
    this.status.value = failed ? 'Не все разговоры удалось прочитать' : ''
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
    ChatStorage.getInstance().invalidateDiscussion(path)
    if (oldPath) ChatStorage.getInstance().invalidateDiscussion(oldPath)
    const revision = (this.revisions.get(path) ?? 0) + 1
    this.revisions.set(path, revision)
    this.removed.delete(path)
    try {
      if (oldPath) await CommentService.getInstance().handleConversationRename(file, oldPath)
      const metadata = await this.inspect(file)
      if (this.disposed || file.path !== path || this.revisions.get(path) !== revision) return
      if (metadata?.metadata.type === 'abele-chat') {
        if (metadata.committed) {
          await this.reconcileDiscussionOwners(file.path, metadata.metadata)
          this.acceptDisk(file.path, metadata.metadata)
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
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1)
    this.acceptDisk(path, metadata, false)
    this.publish()
  }
  deleted(path: string): void {
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
          if (!metadata) throw new Error('Разговор недоступен')
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
            throw new Error('Разговор открыт. Повтори действие.')
        }
      )
    }
    await this.updateFile(file)
  }
  async open(row: AttentionRow, reason: AttentionReason): Promise<boolean> {
    const chats = ChatService.getInstance()
    if (row.reference.kind !== 'local') return false
    const ref = row.reference
    if (!ref.path && ref.sessionId) {
      const session = chats.getSession(ref.sessionId)
      if (!session) {
        new Notice('Разговор больше недоступен')
        return false
      }
      const current = chats.contextualOpenGuard(session)
      if (!chats.adoptSession(session, current)) return false
      await chats.revealSidebar({ focus: false, current })
      if (!chats.isForegroundPresentation(current)) return false
      if (reason.target) chats.pendingReveal.value = reason.target
      return true
    }
    const existing = [...this.live.keys()].find((s) => s.currentChatFile.value?.path === ref.path)
    const inTab = existing && chats.getSession(existing.id)
    if (!inTab && !chats.canCreateTab && !(await this.chooseTab())) return false
    const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(ref.path)
    if (!(file instanceof TFile)) {
      this.deleted(row.key)
      new Notice('Разговор больше недоступен')
      return false
    }
    const presentationCurrent = chats.fileOpenGuard(file)
    chats.openingSelection.value = true
    try {
      if (ref.commentId) {
        if (!(await CommentService.getInstance().revealForAttention(file, presentationCurrent))) return false
      } else {
        await chats.openChatFile(file, presentationCurrent)
        await chats.revealSidebar({ focus: false, current: presentationCurrent })
      }
      const session = chats.activeSession.value
      if (!chats.isForegroundPresentation(presentationCurrent) || !session || session.currentChatFile.value?.path !== ref.path) return false
      await this.updateFile(file)
      if (!session.isMidTurn && !session.attentionBusy) await session.reconcileForSelectionReturn(presentationCurrent)
      if (!chats.isForegroundPresentation(presentationCurrent) || chats.activeSession.value !== session) return false
      const current = this.liveRow(session)
      if (current?.uncertain)
        new Notice('Состояние не подтверждено. Открыта сохранённая версия разговора.')
      // Opening is read-only. Missing index evidence is not recreated into the conversation.
      if (!current?.reasons.some((r) => r.id === reason.id))
        new Notice('Ответ уже принят или запрос больше не действует')
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
        label: chats.getPresentation(id)?.label.value || 'Чат',
      })),
      (id) => chats.closeTab(id)
    )
  }
  private destroy(): void {
    this.disposed = true
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
      title: 'Выбери вкладку для закрытия',
      size: 'tall',
      cls: ['abele-agents-tabs'],
    })
    modal.bodyEl.createEl('p', {
      text: 'Все 20 вкладок открыты. Закроется только выбранная вкладка.',
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
            new Notice(error instanceof Error ? error.message : 'Не удалось закрыть вкладку')
          }
        )
      })
    }
    modal.open()
  })
}
