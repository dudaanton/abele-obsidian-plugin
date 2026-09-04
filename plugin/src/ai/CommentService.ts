import { ref, shallowReactive, watch, type Ref, type WatchStopHandle } from 'vue'
import { Notice, TFile, TFolder } from 'obsidian'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { CommentEntry } from '@/entities/Comment'
import { genid } from '@/helpers/vueUtils'
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
import { type ChatMetadata, type CommentAnchor } from './types'

/**
 * What became of a comment somebody asked to open as a chat.
 *
 * `busy` is a turn it may not be taken out of, or a move already running; `no-room` is a tab
 * bar that is full, which is said out loud where it is found. The two read differently to a
 * person and neither of them is the other.
 */
export type CommentMoveResult = 'moved' | 'busy' | 'no-room'

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
   * A press on a marker: fold the card if one of its comments is the open one, otherwise show
   * the first. A marker carrying several opens on the one it was left showing last only by
   * accident — the card's own strip is where the rest are picked from.
   */
  toggleOpen(ids: string[]): void {
    const openHere = ids.some((id) => id === this.open.value)
    this.open.value = openHere ? null : (ids[0] ?? null)
  }

  /**
   * A press on a marker, answered with the host the pane can actually show.
   *
   * With room beside the text the card is a sidenote and the press is a toggle. Without —
   * a narrow split, a phone — there is nowhere to hang a 300 px card, so the same card goes
   * into a dialog and the dialog expands it on mount; `open` is left alone here so that one
   * value goes on saying which card is open and the marker's icon keeps agreeing with what
   * is on screen.
   *
   * Not the chat sidebar, which is what 1.17.1 tried: that view is the agent's own, with its
   * tabs, its history and its own idea of what a chat is, and a comment borrowed into it is a
   * comment in somebody else's room. The dialog is the comment's own.
   */
  openFrom(ids: string[], hasRoom: boolean, notePath: string): void {
    // A comment that has become a chat is a chat: the marker is a way back into it and not a
    // card any more. Wherever the pane is wide or narrow, that way leads to the sidebar, which
    // is where the conversation went — and it leads there again after the tab has been closed,
    // which is the dead end the card's two buttons used to leave behind.
    //
    // Only the first, because that is the one a press opens. A marker can carry a comment and
    // a chat at once, and then the press is about the comment; the chat is one tab along in
    // the card's own strip, which sends it here itself.
    const first = ids[0]
    if (first && this.expanded.has(first)) {
      void this.revealChat(first)
      return
    }

    if (hasRoom) {
      this.toggleOpen(ids)
      return
    }

    const entry = this.hostFor(ids, notePath)
    if (!entry) return

    GlobalStore.getInstance().commentModal.value = entry
  }

  /**
   * Puts the chat an expanded comment became in front of the person.
   *
   * `adoptSession` rather than `switchTab`: the tab may have been closed since, and a session
   * `ChatService` is not holding is one `switchTab` does nothing for. It is held either way —
   * `expand` moved it into `expanded`, and it is destroyed only with the comment itself.
   */
  async revealChat(id: string): Promise<void> {
    const session = this.expanded.get(id)
    if (!session) return

    const chatService = ChatService.getInstance()
    if (!chatService.adoptSession(session)) return
    await chatService.revealSidebar()
  }

  /**
   * The margin host these ids belong to, or one made for the occasion.
   *
   * Hosts belong to live-preview views and are only minted where there is a margin to hang
   * them in — which is exactly what a phone has not — so the second half is the usual one.
   * The note comes from the pane the icon was pressed in, not from a loaded session: a marker
   * pressed before its comment has been read off disk still knows which note it is in.
   */
  private hostFor(ids: string[], notePath: string): CommentEntry | null {
    const key = ids.join(',')
    const known = GlobalStore.getInstance().commentsContainers.value.find(
      (entry) => entry.ids.join(',') === key
    )
    if (known) return known

    const note = notePath || ids.map((id) => this.sessionFor(id)?.anchor.value?.note).find(Boolean)
    if (!note) return null

    return new CommentEntry({ id: genid(), ids: [...ids], notePath: note, markerFrom: 0 })
  }

  /**
   * The marker draws itself open from the same value the card does, so both notes have to be
   * told: the one that lost the open card and the one that gained it. They are usually the
   * same note, which is what the set is for.
   */
  private readonly openWatcher = watch(this.open, (id, previous) => {
    const notes = new Set<string>()
    for (const which of [previous, id]) {
      const note = which ? this.sessionFor(which)?.anchor.value?.note : null
      if (note) notes.add(note)
    }
    for (const note of notes) dispatchCommentsChanged(note)
  })

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
  private readonly missing = shallowReactive(new Set<string>())

  /** True once an id has been written off, which is what a card says instead of "reading…". */
  isMissing(id: string): boolean {
    return this.missing.has(id)
  }

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
    return ChatStorage.commentsFolder()
  }

  commentPath(id: string): string {
    return `${this.folder()}/${id}.abchat`
  }

  /**
   * Forgets every id that failed to load.
   *
   * Called when `commentFolder` changes in settings: an id written off under the old folder
   * would otherwise never be asked for again, even though the new folder may hold its file.
   */
  resetMissing(): void {
    this.missing.clear()
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
    // Watched like any other: a comment that came back as a tab is still drawn as an icon in
    // the note, and an unwatched session leaves that icon frozen on whatever it last showed.
    this.watchState(id, restored)
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
   *
   * `from` is where the selection started; it defaults to `pos`, which is what a caret is.
   * Both ends travel because a marker the selection covered is one this comment is about, and
   * `insertMarker` merges into it instead of writing a second icon beside it.
   */
  async create(
    note: TFile,
    pos: number,
    quote: string | undefined,
    from: number = pos
  ): Promise<ChatSession> {
    const { app } = GlobalStore.getInstance()
    const id = newCommentId()

    await app.vault.process(note, (text) => insertMarker(text, pos, id, from).text)

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
    this.watchState(id, session)
  }

  /**
   * The one thing that makes a marker say what its conversation is doing.
   *
   * Streaming, running a tool, waiting on an approval, failed — all of it is `commentState`,
   * and the icon is redrawn by dispatching into every editor showing the note. It holds for
   * both hosts, because both show the same session: a card in the margin, and the sidebar tab
   * a phone opens instead.
   */
  private watchState(id: string, session: ChatSession): void {
    if (this.watchers.has(id)) return

    this.watchers.set(
      id,
      // `pinned` rides along with the state: pinning is done on one session, and every editor
      // showing the note has to rebuild its margin from it. So does the visible conversation:
      // a retry or a branch switch takes a pinned message off the path, and `get` stops
      // reporting it — but nothing else would tell the margin to drop the card.
      watch([session.commentState, session.pinned, session.messages], () => {
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
      // Only pins whose message is still in the conversation: a retry or a branch can take one
      // away, and a host for a message nobody can render is a hole in the margin's stack.
      pinned: session.pinned.value.filter((mid) =>
        session.messages.value.some((message) => message.id === mid)
      ),
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
      try {
        await session.load(file)
      } catch (e) {
        // A file that will not parse is a file no repeat will fix, and the marker asks again
        // every repaint — so it is written off here rather than retried for ever, and the
        // half-built session goes with it.
        console.error(`[Abele] Failed to read comment ${id}:`, e)
        session.destroy()
        this.missing.add(id)
        return null
      }

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

  /**
   * The session for a comment file `ChatService` is restoring a tab for.
   *
   * It is `load` plus the bookkeeping a restored tab needs. Only an expanded comment has one:
   * it is a chat now, `ChatService` owns it, and it is moved out of `sessions` to say so.
   *
   * A comment that is still a comment gets no tab and is refused here. 1.17.1 lent the sidebar
   * to comments and could save such a tab; restoring one now would put a card's session in a
   * bar whose × means "close", over a file the margin is still writing.
   *
   * Loading it and *then* letting `restoreTabs` build its own is what put two log writers on
   * one file — the editor is up before `onLayoutReady`, so the comment is usually read first.
   */
  async handOverToTab(id: string): Promise<ChatSession | null> {
    const session = await this.load(id)
    if (!session) return null

    if (session.kind === 'comment') return null

    if (this.sessions.delete(id)) this.expanded.set(id, session)
    return session
  }

  // ── Becoming a chat ───────────────────────────────────────────

  /**
   * Promotes a comment into a full chat, spec §3.
   *
   * The file does not move and the anchor is not dropped: the marker keeps resolving, and a
   * press on it opens the chat this became rather than a card. What changes is who the
   * conversation is for — the default agent, a tab, and a place in the history.
   *
   * Answers with what happened, so a caller can say why it did not move: a turn it may not be
   * taken out of, or a tab bar with no room in it.
   */
  async expand(id: string): Promise<CommentMoveResult> {
    const session = this.sessions.get(id)
    if (!session) return 'busy'

    // Not into the middle of a turn: the kind, the agent and the scope are all read by a
    // request already in flight, and the switch would append a divider between a `tool_use`
    // and its `tool_result`. The same refusal `addUserNote` makes, for the same reason.
    // And not twice at once — see `ChatSession.moving`.
    if (session.isMidTurn || session.moving.value) return 'busy'

    // Before anything moves. The sidebar keeps a limit on its tabs, and it used to be asked
    // last: the file already said "chat", the history already had an entry, and the answer was
    // no — a conversation filed as a chat that nothing was holding, with no way back.
    if (!ChatService.getInstance().hasRoomFor(session)) {
      new Notice(ChatService.TABS_FULL)
      return 'no-room'
    }

    // Read before anything is touched: the name wanted here is the question that started the
    // comment, and `titleFor` reads the visible path a divider would recompute.
    const title = session.chatTitle.value || CommentService.titleFor(session) || id

    const previousKind = session.kind
    const previousAgentId = session.agentId.value
    const previousOverrides = session.overrides.value
    const previousTitle = session.chatTitle.value

    session.moving.value = true
    try {
      session.kind = 'chat'

      const fallback = AgentRegistry.getInstance().defaultAgent()
      // Bound rather than switched: nothing is said about the move until the file has taken it.
      // The binding re-syncs the scope, and the anchored note survives that — `applyScope` puts
      // it back. Overrides are dropped, which is right: they were the comment agent's.
      const switched = fallback ? session.bindAgent(fallback.id) : false

      const file = session.currentChatFile.value
      // Named before it is saved, not after: `saveChat` pushes the snapshot's title back over
      // the history entry, and an unnamed chat falls back to "<date> Chat" — which tells a
      // person browsing the list rather less than the question they asked does.
      if (file) session.chatTitle.value = title

      try {
        await session.save()
      } catch (e) {
        // The file still says "comment", so nothing here may say otherwise: a session filed as
        // a chat over a file that is not one comes back after a restart as both, read twice and
        // written by two sessions. Everything the save was for goes back instead, the per-chat
        // overrides included — the binding dropped them for a move that never happened.
        session.kind = previousKind
        session.chatTitle.value = previousTitle
        session.bindAgent(previousAgentId)
        session.restoreOverrides(previousOverrides)
        throw e
      }

      // Persisted, so it can be said out loud — and only if there was a switch to speak of.
      // A vault whose comment agent *is* the default agent switches nothing here, and a
      // divider for that is a line about something that did not happen.
      if (switched && fallback) session.noteAgentSwitch(fallback.id)

      if (file) {
        // Explicit, because `refreshHistory` only ever scans the chat folder. Known entries are
        // kept whatever folder they are in, so this one stays.
        ChatStorage.getInstance().addHistoryEntry({
          path: file.path,
          title,
          created: dayjs().format('YYYY-MM-DD'),
        })
        // A comment records the notes it wrote to but has no entry to mirror them into; now
        // that it has one, the chat arrives carrying the work it already did — including the
        // one recap it never paid for while it was on the margin.
        session.mirrorNoteLinks()
        session.recapIfMissing()
      }

      this.sessions.delete(id)
      this.expanded.set(id, session)

      const chatService = ChatService.getInstance()
      // Room was asked for before any of this: nothing here can be refused any more.
      chatService.adoptSession(session)
      await chatService.revealSidebar()

      // Folded: what was in the card is in the sidebar now, and a card left open over a
      // conversation that has moved is a card showing a copy of it.
      if (this.open.value === id) this.open.value = null

      const note = session.anchor.value?.note
      if (note) dispatchCommentsChanged(note)
      return 'moved'
    } finally {
      session.moving.value = false
    }
  }

  /**
   * What to call a comment where a chat would show its title: the history list it joins on
   * promotion, and the tab strip while it is being read in the sidebar.
   *
   * A comment has no title of its own — title generation is gated on `kind === 'chat'` — and
   * the file name is a random six characters, which tells a person browsing nothing. The
   * question that was asked does. Static because the tab strip has a session and no id.
   */
  static titleFor(session: ChatSession): string {
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

      // Either condition, not just the anchor: a comment can write to a note it is not
      // anchored in, and its own file is the only copy of those links until it is expanded.
      const loaded = this.sessionFor(child.basename)
      if (loaded) {
        const anchor = loaded.anchor.value
        const anchored = anchor?.note === oldPath
        const wrote = loaded.touched.value.some((note) => note.path === oldPath)
        if (!anchored && !wrote) continue
        if (anchored && anchor) loaded.anchor.value = { ...anchor, note: newPath }
        if (wrote) {
          loaded.touched.value = ChatStorage.renamedNotes(loaded.touched.value, oldPath, newPath)
        }
        // The session owns this file; letting it write keeps its log writer in step.
        await loaded.save()
        continue
      }

      const metadata = parseChatMetadata(await app.vault.read(child))
      if (!metadata) continue
      const anchored = metadata.anchor?.note === oldPath
      const wrote = metadata.touched?.some((note) => note.path === oldPath) ?? false
      if (!anchored && !wrote) continue
      await app.vault.append(
        child,
        serializeMetadata({
          ...metadata,
          anchor:
            anchored && metadata.anchor ? { ...metadata.anchor, note: newPath } : metadata.anchor,
          touched: metadata.touched
            ? ChatStorage.renamedNotes(metadata.touched, oldPath, newPath)
            : undefined,
        })
      )
    }

    dispatchCommentsChanged(newPath)
  }

  // ── Following the folder ──────────────────────────────────────

  /**
   * A `.abchat` file appeared under the comments folder — sync, a restore, or a device catching
   * up on a comment made elsewhere. Only `missing` needs correcting: an id that was never
   * written off has nothing to clear, and a session already loaded is not re-read here, only
   * on the next `touch`.
   */
  handleFileCreated(id: string): void {
    if (!this.missing.delete(id)) return

    const note = this.sessionFor(id)?.anchor.value?.note
    if (note) dispatchCommentsChanged(note)
  }

  /**
   * A `.abchat` file vanished from under the comments folder — sync, a restore going the other
   * way, or somebody deleting it by hand outside the plugin. The marker is not touched; forgets
   * whatever session was reading the file, so the next `touch` reads it again rather than one
   * that no longer matches what is on disk.
   */
  handleFileDeleted(id: string): void {
    const session = this.sessions.get(id) ?? this.expanded.get(id) ?? null
    const note = session?.anchor.value?.note ?? null

    this.watchers.get(id)?.()
    this.watchers.delete(id)
    this.sessions.delete(id)
    this.expanded.delete(id)
    this.missing.add(id)
    if (this.open.value === id) this.open.value = null

    if (session) {
      // Unload is synchronous, so this cannot be awaited — starting the write is the point.
      void session.flush()
      session.destroy()
    }
    if (note) dispatchCommentsChanged(note)
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
    // Stopped first: it must not fire on the `open.value = null` further down.
    this.openWatcher()

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
