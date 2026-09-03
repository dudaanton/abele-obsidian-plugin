import { ref, shallowReactive, watch, type Ref, type WatchStopHandle } from 'vue'
import { TFile } from 'obsidian'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { insertMarker, newCommentId, removeMarkerId } from '@/editor/commentMarkers'
import {
  dispatchCommentsChanged,
  type CommentInfo,
  type CommentInfoSource,
} from '@/editor/CommentPlugin'
import { ChatSession } from './ChatSession'
import { ChatService } from './ChatService'
import { ChatStorage } from './ChatStorage'
import { AgentRegistry } from './agents/AgentRegistry'
import { parseChatMetadata, serializeChat } from './ChatLog'
import { DEFAULT_AI_SETTINGS, type ChatMetadata, type CommentAnchor } from './types'

/**
 * The comments of this vault: their files, their sessions, and the markers that point at them.
 *
 * It owns comment sessions the way `ChatService` owns tabs, and for the same reason — one
 * session per file, so two writers never interleave records in one log. The editor reads it
 * synchronously through `CommentInfoSource`; everything slow is a load it starts and reports
 * back with `dispatchCommentsChanged`.
 */
export class CommentService implements CommentInfoSource {
  private static instance: CommentService | null = null

  static getInstance(): CommentService {
    if (!CommentService.instance) CommentService.instance = new CommentService()
    return CommentService.instance
  }

  /** Live comments, by id. Reactive so a card re-renders when one arrives. */
  readonly sessions = shallowReactive(new Map<string, ChatSession>())

  /** Which card is expanded. One at a time; the rest are icons. */
  readonly open: Ref<string | null> = ref(null)

  /**
   * Comments promoted into full chats.
   *
   * `ChatService` owns these now, but the marker is still in the note and the editor still
   * asks about the id — so they are kept here to be answered with, and above all so `touch`
   * never loads the same file into a second session.
   */
  private readonly expanded = new Map<string, ChatSession>()

  /** Stops the state watcher of each session, so a removed comment stops repainting. */
  private readonly watchers = new Map<string, WatchStopHandle>()

  /** Loads in flight: a field that repaints twice must not start two of them. */
  private readonly loading = new Map<string, Promise<ChatSession | null>>()

  private folder(): string {
    return AbeleConfig.getInstance().ai.commentFolder || DEFAULT_AI_SETTINGS.commentFolder
  }

  commentPath(id: string): string {
    return `${this.folder()}/${id}.abchat`
  }

  /** True for a file this service owns. A path join, because the name *is* the id. */
  isCommentFile(file: TFile): boolean {
    return file.path === this.commentPath(file.basename)
  }

  private sessionFor(id: string): ChatSession | null {
    return this.sessions.get(id) ?? this.expanded.get(id) ?? null
  }

  // ── Making one ────────────────────────────────────────────────

  /**
   * A new comment at `pos`: the marker into the note, the file into the comment folder, and a
   * session on top of the file.
   *
   * The file is written here rather than left to the session, because a session with no
   * messages writes nothing — and the marker would then point at a file that does not exist.
   */
  async create(note: TFile, pos: number, quote: string | undefined): Promise<ChatSession> {
    const { app } = GlobalStore.getInstance()
    const id = newCommentId()

    await app.vault.process(note, (text) => insertMarker(text, pos, id).text)

    const config = AbeleConfig.getInstance().ai
    const registry = AgentRegistry.getInstance()
    const agent = registry.get(config.commentAgentId ?? '') ?? registry.defaultAgent()
    const anchor: CommentAnchor = { note: note.path, quote }

    const metadata: ChatMetadata = {
      type: 'abele-chat',
      kind: 'comment',
      anchor,
      agentId: agent?.id,
      providerId: agent?.providerId || config.activeProviderId,
      modelId: agent?.modelId || config.activeModelId,
      created: dayjs().format('YYYY-MM-DD'),
    }

    await ChatStorage.getInstance().ensureFolder(this.folder())
    const file = await app.vault.create(
      this.commentPath(id),
      serializeChat({ metadata, messages: [], internalMessages: [] })
    )

    const session = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'comment',
      agentId: agent?.id,
      anchor,
    })
    await session.load(file)
    this.adopt(id, session)

    dispatchCommentsChanged(note.path)
    return session
  }

  /** Files it and starts watching its state, so the icon follows the conversation. */
  private adopt(id: string, session: ChatSession): void {
    this.sessions.set(id, session)
    this.watchers.set(
      id,
      watch(session.commentState, () => {
        const note = session.anchor.value?.note
        if (note) dispatchCommentsChanged(note)
      })
    )
  }

  // ── CommentInfoSource ─────────────────────────────────────────

  get(id: string): CommentInfo | undefined {
    const session = this.sessionFor(id)
    if (!session) return undefined

    return {
      quote: session.anchor.value?.quote,
      state: session.commentState.value,
      open: this.open.value === id,
    }
  }

  touch(notePath: string, ids: string[]): void {
    const unseen = ids.filter((id) => !this.sessionFor(id) && !this.loading.has(id))
    if (!unseen.length) return

    void Promise.all(unseen.map((id) => this.load(id))).then(() => {
      // The field asked before the files were read; this is what tells it to ask again.
      dispatchCommentsChanged(notePath)
    })
  }

  async load(id: string): Promise<ChatSession | null> {
    const known = this.sessionFor(id)
    if (known) return known

    const pending = this.loading.get(id)
    if (pending) return pending

    const task = (async (): Promise<ChatSession | null> => {
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(this.commentPath(id))
      if (!(file instanceof TFile)) return null

      const session = new ChatSession(ChatService.getInstance(), undefined, { kind: 'comment' })
      await session.load(file)
      this.adopt(id, session)
      return session
    })()

    this.loading.set(id, task)
    try {
      return await task
    } finally {
      this.loading.delete(id)
    }
  }

  // ── Removing one ──────────────────────────────────────────────

  /**
   * Deletes a comment: its id out of the marker, the marker itself when it was the last id,
   * and the file. A marker deleted by hand leaves the file behind; orphans are not collected.
   */
  async remove(id: string): Promise<void> {
    const session = this.sessionFor(id)
    const notePath = session?.anchor.value?.note ?? (await this.anchorOnDisk(id))?.note ?? null

    if (notePath) {
      const { app } = GlobalStore.getInstance()
      const note = app.vault.getAbstractFileByPath(notePath)
      if (note instanceof TFile) {
        await app.vault.process(note, (text) => removeMarkerId(text, id))
      }
    }

    this.watchers.get(id)?.()
    this.watchers.delete(id)

    if (this.sessions.delete(id)) {
      session?.destroy()
    } else if (this.expanded.delete(id) && session) {
      // Expanded: `ChatService` owns it, and closing the tab is what saves and disposes it.
      await ChatService.getInstance().closeTab(session.id)
    }

    await ChatStorage.getInstance().deleteChat(this.commentPath(id))
    if (this.open.value === id) this.open.value = null
    if (notePath) dispatchCommentsChanged(notePath)
  }

  /** The anchor of a comment nobody has loaded — one metadata read, no session. */
  private async anchorOnDisk(id: string): Promise<CommentAnchor | null> {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(this.commentPath(id))
    if (!(file instanceof TFile)) return null
    return parseChatMetadata(await app.vault.read(file))?.anchor ?? null
  }

  // ── Teardown ──────────────────────────────────────────────────

  destroy(): void {
    for (const stop of this.watchers.values()) stop()
    this.watchers.clear()

    for (const session of this.sessions.values()) {
      // Unload is synchronous, so this cannot be awaited — starting the write is the point.
      void session.flush()
      session.destroy()
    }
    this.sessions.clear()
    // Expanded sessions belong to ChatService, which disposes of its own.
    this.expanded.clear()
    this.loading.clear()
    this.open.value = null
    CommentService.instance = null
  }
}
