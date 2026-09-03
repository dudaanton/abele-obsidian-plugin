import { ref, shallowReactive, watch, type Ref, type WatchStopHandle } from 'vue'
import { TFile, TFolder } from 'obsidian'
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
import { parseChatMetadata, serializeChat, serializeMetadata } from './ChatLog'
import { DEFAULT_AI_SETTINGS, type ChatMetadata, type CommentAnchor } from './types'

/** As long as a chat's own fallback title, which this stands in for. */
const COMMENT_TITLE_LENGTH = 50

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

  /**
   * Ids with no file behind them.
   *
   * Without this a marker whose comment has been deleted by hand livelocks the editor: the
   * load finds nothing, the answer repaints the field, the field touches the id again. They
   * are forgotten whenever the folder's contents may have changed under us.
   */
  private readonly missing = new Set<string>()

  /**
   * Bumped when a comment is removed, so a load already reading that file does not adopt it
   * afterwards and quietly resurrect a comment the person deleted.
   */
  private readonly generations = new Map<string, number>()

  /** Loads started since the last repaint, and the notes waiting to hear about them. */
  private readonly batch: Promise<ChatSession | null>[] = []
  private readonly pendingNotes = new Set<string>()
  private settling = false

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

  /**
   * The session answering for this id, whoever is holding it.
   *
   * Two things are reconciled here rather than at every call site. A session whose tab was
   * closed has been destroyed and reports state nothing updates any more, so it is dropped
   * and the comment is read again from its file. And after a restart an expanded comment
   * comes back as one of `ChatService`'s tabs, which this adopts — otherwise the first
   * `touch` would build a second session on a file that already has one writing it.
   *
   * Public because the card needs it: after "open as chat" a session leaves `sessions` for
   * `expanded`, and the card still has to render it — read-only, with its first exchange and
   * a way into the sidebar.
   */
  sessionFor(id: string): ChatSession | null {
    const known = this.sessions.get(id) ?? this.expanded.get(id) ?? null
    if (known && !known.isDestroyed) return known
    if (known) this.forget(id)

    const restored = ChatService.getInstance().getSessionByFile(this.commentPath(id))
    if (!restored) return null

    this.expanded.set(id, restored)
    return restored
  }

  /** Drops every trace of a session without touching the file it was read from. */
  private forget(id: string): void {
    this.watchers.get(id)?.()
    this.watchers.delete(id)
    this.sessions.delete(id)
    this.expanded.delete(id)
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

    // The folder has a new file in it, so what was known to be absent may not be any more.
    this.missing.clear()

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
    const unseen = ids.filter(
      (id) => !this.sessionFor(id) && !this.loading.has(id) && !this.missing.has(id)
    )
    if (!unseen.length) return

    for (const id of unseen) this.batch.push(this.load(id))
    this.pendingNotes.add(notePath)
    this.scheduleRepaint()
  }

  /**
   * One repaint per batch of loads, once they have all settled.
   *
   * The field calls `touch` once per marker inside a single synchronous rebuild, so answering
   * each one separately would repaint a note with five comments five times, and every repaint
   * asks again. The microtask is what collects that whole rebuild into one answer; nothing is
   * dispatched at all unless a load actually produced a session, which is what keeps a marker
   * with no file from starting the cycle over.
   */
  private scheduleRepaint(): void {
    if (this.settling) return
    this.settling = true

    void Promise.resolve().then(async () => {
      let produced = false

      // A load may adopt a session whose watcher starts another; draining rather than
      // awaiting once keeps those in the same batch instead of giving them a repaint each.
      while (this.batch.length) {
        const wave = this.batch.splice(0)
        const results = await Promise.allSettled(wave)
        produced ||= results.some((r) => r.status === 'fulfilled' && r.value !== null)
      }

      const notes = [...this.pendingNotes]
      this.pendingNotes.clear()
      this.settling = false

      if (!produced) return
      for (const note of notes) dispatchCommentsChanged(note)
    })
  }

  async load(id: string): Promise<ChatSession | null> {
    const known = this.sessionFor(id)
    if (known) return known

    const pending = this.loading.get(id)
    if (pending !== undefined) return pending

    const generation = this.generations.get(id) ?? 0

    const task = (async (): Promise<ChatSession | null> => {
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(this.commentPath(id))
      if (!(file instanceof TFile)) {
        this.missing.add(id)
        return null
      }

      const session = new ChatSession(ChatService.getInstance(), undefined, { kind: 'comment' })
      await session.load(file)

      if ((this.generations.get(id) ?? 0) !== generation) {
        // Removed while this was reading it. Filing it now would put a deleted comment back.
        session.destroy()
        return null
      }

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

  // ── Becoming a chat ───────────────────────────────────────────

  /**
   * Promotes a comment into a full chat, spec §3.
   *
   * The file does not move and the anchor is not dropped: the marker keeps resolving, and the
   * card goes on showing the first exchange with a way back into the sidebar. What changes is
   * who it is for — the default agent, a tab, and a place in the history.
   */
  async expand(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return

    session.kind = 'chat'
    // Read before the agent switch, which appends a divider message and recomputes the
    // visible path: the name wanted here is the question that started the comment.
    const title = session.chatTitle.value || this.titleFor(session) || id

    const fallback = AgentRegistry.getInstance().defaultAgent()
    // `switchAgent` re-syncs the scope, and the anchored note survives that: `applyScope`
    // puts it back. Overrides are dropped, which is right — they were the comment agent's.
    if (fallback) session.switchAgent(fallback.id)

    const file = session.currentChatFile.value
    if (file) {
      // Named before it is saved, not after: `saveChat` pushes the snapshot's title back over
      // the history entry, and an unnamed chat falls back to "<date> Chat" — which tells a
      // person browsing the list rather less than the question they asked does.
      session.chatTitle.value = title

      // Explicit, because `refreshHistory` only ever scans the chat folder. Known entries are
      // kept whatever folder they are in, so this one stays.
      ChatStorage.getInstance().addHistoryEntry({
        path: file.path,
        title,
        created: dayjs().format('YYYY-MM-DD'),
      })
    }

    this.sessions.delete(id)
    this.expanded.set(id, session)

    const chatService = ChatService.getInstance()
    chatService.adoptSession(session)
    await session.save()
    await chatService.revealSidebar()

    const note = session.anchor.value?.note
    if (note) dispatchCommentsChanged(note)
  }

  /**
   * What to call an expanded comment in the history list.
   *
   * A comment has no title of its own — title generation is gated on `kind === 'chat'`, which
   * it was not until a moment ago — and the file name is a random six characters, which tells
   * a person browsing the list nothing. The question that was asked does.
   */
  private titleFor(session: ChatSession): string {
    const asked = session.messages.value.find((message) => message.role === 'user')
    if (!asked) return ''

    return asked.content.replace(/\s+/g, ' ').trim().slice(0, COMMENT_TITLE_LENGTH)
  }

  /**
   * A comment file opened in a leaf by hand.
   *
   * The sidebar can only show a chat, so this is taken as asking for one — the same move the
   * card's "open as chat" makes. Going through `expand` is what keeps a single session on the
   * file; `ChatService.openChatFile` would have built a second one on top of it.
   */
  async openFile(file: TFile): Promise<void> {
    const chatService = ChatService.getInstance()

    const already = chatService.getSessionByFile(file.path)
    if (already) {
      chatService.switchTab(already.id)
      await chatService.revealSidebar()
      return
    }

    const id = file.basename
    if (!(await this.load(id))) return
    await this.expand(id)
  }

  // ── Following the note ────────────────────────────────────────

  /**
   * Rewrites `anchor.note` in every comment that pointed at `oldPath`.
   *
   * Renames are rare and comments are one flat folder, so reading each one's metadata is
   * cheaper to write and to trust than an index that has to be kept correct.
   */
  async handleRename(oldPath: string, newPath: string): Promise<void> {
    // Every comment file is about to be read anyway; an id written off earlier deserves
    // another look rather than staying blank for the rest of the session.
    this.missing.clear()

    const { app } = GlobalStore.getInstance()
    const folder = app.vault.getAbstractFileByPath(this.folder())
    if (!(folder instanceof TFolder)) return

    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== 'abchat') continue

      const loaded = this.sessionFor(child.basename)
      if (loaded) {
        const anchor = loaded.anchor.value
        if (anchor?.note !== oldPath) continue
        loaded.anchor.value = { ...anchor, note: newPath }
        // The session owns this file; letting it write keeps its log writer in step.
        await loaded.save()
        continue
      }

      const metadata = parseChatMetadata(await app.vault.read(child))
      if (metadata?.anchor?.note !== oldPath) continue
      await app.vault.append(
        child,
        serializeMetadata({ ...metadata, anchor: { ...metadata.anchor, note: newPath } })
      )
    }

    dispatchCommentsChanged(newPath)
  }

  // ── Removing one ──────────────────────────────────────────────

  /**
   * Deletes a comment: its id out of the marker, the marker itself when it was the last id,
   * and the file. A marker deleted by hand leaves the file behind; orphans are not collected.
   */
  async remove(id: string): Promise<void> {
    // Before the first await: a load already reading this file checks it after, and a marker
    // the person left behind must not fetch the file back.
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    this.missing.add(id)

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
    this.missing.clear()
    this.generations.clear()
    this.batch.length = 0
    this.pendingNotes.clear()
    this.settling = false
    this.open.value = null
    CommentService.instance = null
  }
}
