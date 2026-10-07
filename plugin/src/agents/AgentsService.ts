import { computed, ref, shallowRef, watch, type WatchStopHandle } from 'vue'
import { Notice, TFile, type App } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatService } from '@/ai/ChatService'
import { CommentService } from '@/ai/CommentService'
import type { ChatSession } from '@/ai/ChatSession'
import { parseChatMetadata, serializeMetadata } from '@/ai/ChatLog'
import { transformChat } from '@/ai/chatCopy'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import type { ChatMetadata } from '@/ai/types'
import { ShellModal } from '@/modal/ShellModal'
import {
  attentionBadge,
  attentionReasons,
  sortAttention,
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
  readonly incomplete = computed(() => this.localIncomplete.value || this.nodes.value.length > 0)
  readonly status = ref('Обновляется')
  readonly badge = computed(() => attentionBadge(this.rows.value, this.incomplete.value))
  readonly tooltip = computed(
    () =>
      `Агенты · Требуют внимания: ${this.badge.value.attention}. Работают: ${this.badge.value.running}${this.incomplete.value ? ' · Данные неполны' : ''}`
  )
  private readonly files = new Map<string, AttentionRow>()
  private readonly removed = new Set<string>()
  private readonly revisions = new Map<string, number>()
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
    if (row) this.files.set(row.key, row)
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
        ...(metadata.kind === 'comment'
          ? {
              commentId: path
                .split('/')
                .pop()
                .replace(/\.abchat$/, ''),
            }
          : {}),
      },
      title: metadata.title || path.split('/').pop() || 'Чат',
      agent: AgentRegistry.getInstance().get(metadata.agentId ?? '')?.name || 'Агент',
      source: metadata.kind === 'comment' ? `Обсуждение · ${metadata.anchor?.note ?? ''}` : 'Чат',
      quote: metadata.anchor?.quote,
      reasons: attentionReasons(metadata.attention ?? {}, metadata.pendingToolCalls ?? [], live),
    }
  }
  private fileRow(path: string, metadata: ChatMetadata): AttentionRow {
    const row = this.metadataRow(path, metadata, false)
    // A run transition reaches the local index before the next ordinary file save.
    // Retain only explicit newer work evidence, never infer failures from old prose.
    for (const reason of this.files.get(path)?.reasons ?? []) {
      const run = metadata.attention?.run
      if (
        ['running', 'interrupted'].includes(reason.kind) &&
        (!run || (run.id !== reason.id && reason.at > run.at))
      ) {
        row.reasons.push({ ...reason, kind: 'interrupted' })
      }
    }
    return row
  }
  private liveRow(session: ChatSession, live = true): AttentionRow | null {
    const path = session.currentChatFile.value?.path ?? ''
    if ((!live && !path) || this.removed.has(path) || session.isDestroyed || session.kind === 'run')
      return null
    const row = this.metadataRow(
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
      const row = this.liveRow(session)
      if (row) rows.set(row.key, row)
    }
    this.rows.value = sortAttention([...rows.values()].filter((r) => r.reasons.length))
    if (this.started) {
      try {
        const index = this.rows.value
          .filter((row) => row.reference.kind === 'local' && !!row.reference.path)
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
    this.started = true
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
            reasons: entry.reasons,
          })
        }
    } catch {
      this.status.value = 'Не удалось прочитать список'
    }
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
        const metadata = parseChatMetadata(await app.vault.read(file))
        if (this.disposed) return
        if (file.path !== path || (this.revisions.get(path) ?? 0) !== revision) continue
        if (metadata?.type === 'abele-chat')
          this.files.set(file.path, this.fileRow(file.path, metadata))
        else {
          this.files.delete(file.path)
          failed = true
        }
      } catch {
        if ((this.revisions.get(path) ?? 0) === revision) failed = true
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
    for (const path of this.files.keys()) if (!paths.has(path)) this.files.delete(path)
    this.localIncomplete.value = failed
    this.status.value = failed ? 'Не все разговоры удалось прочитать' : ''
    this.publish()
  }
  /** A changed file costs one read, not a vault scan on every streamed token. */
  async updateFile(file: TFile, oldPath?: string): Promise<void> {
    if (oldPath) this.deleted(oldPath)
    const path = file.path
    const revision = (this.revisions.get(path) ?? 0) + 1
    this.revisions.set(path, revision)
    this.removed.delete(path)
    try {
      const metadata = parseChatMetadata(await GlobalStore.getInstance().app.vault.read(file))
      if (this.disposed || file.path !== path || this.revisions.get(path) !== revision) return
      if (metadata?.type === 'abele-chat')
        this.files.set(file.path, this.fileRow(file.path, metadata))
      else {
        this.localIncomplete.value = true
        this.status.value = 'Не удалось прочитать разговор'
      }
    } catch {
      if (this.revisions.get(path) !== revision) return
      this.localIncomplete.value = true
      this.status.value = 'Не удалось прочитать разговор'
    }
    this.publish()
  }
  setNodes(nodes: { id: string; label: string; expectedNodeId: string }[]): void {
    this.nodes.value = nodes
    this.publish()
  }
  saved(path: string, metadata: ChatMetadata): void {
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1)
    this.files.set(path, this.fileRow(path, metadata))
    this.publish()
  }
  deleted(path: string): void {
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1)
    this.removed.add(path)
    this.files.delete(path)
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
    if (open) await open.markAttentionSeen(id)
    else
      await transformChat(
        app,
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
                errors: state.errors?.map((e) => (e.id === id ? { ...e, seen: true } : e)),
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
      chats.switchTab(session.id)
      await chats.revealSidebar({ focus: false })
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
    chats.openingSelection.value = true
    try {
      if (ref.commentId) {
        if (!(await CommentService.getInstance().revealForAttention(file))) return false
      } else {
        await chats.openChatFile(file)
        await chats.revealSidebar({ focus: false })
      }
      const session = chats.activeSession.value
      if (!session || session.currentChatFile.value?.path !== ref.path) return false
      const savedRun = session.attention.value.run
      if (
        reason.kind === 'interrupted' &&
        (!savedRun || (savedRun.id !== reason.id && reason.at > savedRun.at)) &&
        this.files.get(row.key)?.reasons.some((r) => r.id === reason.id && r.kind === 'interrupted')
      ) {
        session.attention.value = {
          ...session.attention.value,
          run: { id: reason.id, at: reason.at, status: 'interrupted', target: reason.target },
        }
        await session.save()
      }
      const current = this.liveRow(session)
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
      title: 'Все 20 вкладок открыты · Выбери, какую закрыть',
      size: 'tall',
      cls: ['abele-agents-tabs'],
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
