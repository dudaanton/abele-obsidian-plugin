import { providerKey } from '@/secrets/destinations'
import { ref, computed, shallowRef } from 'vue'
import { App, Notice, TFile } from 'obsidian'
import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ModelConfig } from './client'
import { DEFAULT_AI_SETTINGS } from './types'
import { AgentRegistry } from './agents/AgentRegistry'
import { getNoteBody } from '@/helpers/notesUtils'
import { ChatSession } from './ChatSession'
import { CommentService } from './CommentService'
import { ChatStorage } from './ChatStorage'
import { RunStorage, type RunFile } from './RunStorage'
import { AI_SIDEBAR_VIEW_TYPE } from '@/constants/views'
import { revealSidebarView } from '@/views/revealSidebarView'
import { buildCommentContext } from './commentContext'
import { buildMessageCommentContext } from './messageComments'
import { LocalChatPresenter, type ChatPresentationSession, type ChatReference } from './ChatPresentationSession'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { NodeService } from '@/node/NodeService'

/** How many chats the sidebar holds open at once. */
export const MAX_TABS = 20
const STORAGE_KEY = 'abele-agent-tabs'

export interface PendingInput {
  text: string
  tabId?: string
  focus?: boolean
  /** Insert text beside the picked chat's existing draft instead of replacing it. */
  append?: boolean
  /** Vault files to attach to what is being written — a picture drawn on, sent back. */
  attachments?: string[]
  /** Replace an unsent original with the picture drawn on, leaving the rest of the draft. */
  replaceAttachment?: string
  /** When returning asynchronously to a tab, refuse a different conversation loaded into it. */
  conversationVersion?: number
}

interface TabsState {
  tabs: Array<ChatReference | { kind?: undefined; chatFilePath: string | null }>
  activeIndex: number
}

export class ChatService {
  private static instance: ChatService | null = null

  private sessions = new Map<string, ChatSession>()
  private nodeSessions = new Map<string, NodeChatPresenter>()
  /**
   * Read-only tabs showing a delegated run.
   *
   * A run is a file, not a live session — nothing can be typed into it and nothing streams
   * from it, so it sits alongside the chat sessions rather than pretending to be one.
   */
  private runTabs = new Map<string, RunFile>()
  private tabsRestored = false
  private restoringTabs = false
  private restoreGeneration = 0
  private continueRestore: (() => void) | null = null
  private loadingFiles = new Map<
    string,
    {
      session: ChatSession | null
      ready: Promise<ChatSession | null>
    }
  >()
  public readonly activeTabId = ref<string | null>(null)
  public readonly tabOrder = ref<string[]>([])

  public readonly activeSession = computed<ChatSession | null>(() =>
    this.activeTabId.value ? (this.sessions.get(this.activeTabId.value) ?? null) : null
  )

  /**
   * Text to pre-fill in the chat input, consumed by the chat component.
   *
   * `tabId` names the tab it was meant for — a tab switch that arrives with it puts that tab's
   * own draft back, and without knowing the text belongs there it would put back an empty one
   * over it. Without a `tabId` it goes to whatever tab is in front. `focus` also puts the
   * cursor after it.
   */
  public readonly pendingInput = ref<PendingInput | null>(null)

  /**
   * A message to bring into view in the active chat, by id — a card in a note was pressed.
   * The chat component consumes it, as it does `pendingInput`.
   */
  /** Suppress composer autofocus while opening a read-only selection return. */
  public readonly openingSelection = ref(false)
  public readonly pendingAnchorReturn = shallowRef<{
    sessionId: string
    target: Extract<import('./chatAnchorNavigation').AnchorReturn, { status: 'ready' }>
  } | null>(null)
  public readonly pendingReveal = ref<string | null>(null)
  /** A comment return can address a passage within that message, in one specific chat. */
  public readonly pendingPassage = ref<{ path: string; message: string; quote: string; start?: number } | null>(null)

  /**
   * A result of the search across chats, for the chat component: once the chat at `path` is in
   * front, the find bar opens on `query` at the message it was found in.
   */
  public readonly pendingFind = ref<{ path: string; query: string; messageId: string } | null>(null)

  /**
   * Set to open the history of chats with its search in the chat in front — the command that
   * searches every chat. The chat component that opens it sets it back.
   */
  public readonly historyRequest = ref(false)

  /** The same for the find bar of the chat in front — the command that finds in it. */
  public readonly findRequest = ref(false)

  /**
   * Bumped to put the cursor in the composer of whatever chat is in front: a new chat, a new
   * comment. The chat answers it; `requestFocus` is the way to ask.
   */
  public readonly focusRequest = ref(0)

  static getInstance(): ChatService {
    if (!ChatService.instance) {
      ChatService.instance = new ChatService()
    }
    return ChatService.instance
  }

  private constructor() {
    // Will be initialized by restoreTabs() or fallback to createTab()
  }

  /** Ensure at least one tab exists (called from components before restoreTabs) */
  ensureInitialized(): void {
    if (!this.tabsRestored && this.tabOrder.value.length === 0) {
      this.createTab()
    }
  }

  /**
   * Tab layout, read from Obsidian's vault-scoped store. It used to sit in a bare
   * `localStorage` key, which is shared by every vault on the machine — so opening a second
   * vault restored the first one's tabs, pointing at chat files that do not exist there. A
   * layout still under the old key is moved across once and the old key dropped.
   */
  private static loadTabsState(app: App): TabsState | null {
    const stored = app.loadLocalStorage(STORAGE_KEY) as TabsState | null
    if (stored) return stored

    const legacy = window.localStorage.getItem(STORAGE_KEY)
    if (!legacy) return null

    window.localStorage.removeItem(STORAGE_KEY)
    try {
      const migrated = JSON.parse(legacy) as TabsState
      app.saveLocalStorage(STORAGE_KEY, migrated)
      return migrated
    } catch {
      return null
    }
  }

  /** Call after plugin load to restore tabs from previous session */
  async restoreTabs(): Promise<void> {
    this.tabsRestored = true
    const generation = ++this.restoreGeneration
    this.continueRestore?.()
    this.continueRestore = null
    this.restoringTabs = false
    this.loadingFiles.clear()
    const { app } = GlobalStore.getInstance()
    const state = ChatService.loadTabsState(app)
    if (!state) {
      if (this.sessions.size === 0) this.createTab()
      return
    }

    // Clear any tabs created before restore
    for (const session of this.sessions.values()) session.destroy()
    this.sessions.clear()
    for (const presenter of this.nodeSessions.values()) presenter.destroy()
    this.nodeSessions.clear()
    this.tabOrder.value = []
    this.activeTabId.value = null

    this.restoringTabs = true
    try {
      if (!state.tabs?.length) {
        this.createTab()
        return
      }

      const activeIndex = Math.max(0, Math.min(state.activeIndex || 0, state.tabs.length - 1))
      const order = [activeIndex, ...state.tabs.map((_, i) => i).filter((i) => i !== activeIndex)]
      const slots: Array<string | undefined> = []
      const publish = (index: number, session: ChatSession | NodeChatPresenter) => {
        slots[index] = session.id
        if (session instanceof NodeChatPresenter) this.nodeSessions.set(session.id, session)
        else this.sessions.set(session.id, session)
        const restored = slots.filter((id): id is string => !!id && (this.sessions.has(id) || this.nodeSessions.has(id)))
        // Tabs opened while restoration was reading stay after the saved layout.
        this.tabOrder.value = [...new Set([...restored, ...this.tabOrder.value])]
        // Select once. Background hydration must not steal a later user selection.
        if (!this.activeTabId.value) this.activeTabId.value = session.id
      }

      for (const index of order) {
        if (index !== activeIndex) {
          // One conversation per turn after the active one is usable, not a chain of parses
          // that delays its first frame. Completion still means every saved tab is hydrated.
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(() => {
              this.continueRestore = null
              resolve()
            }, 0)
            this.continueRestore = () => {
              window.clearTimeout(timer)
              resolve()
            }
          })
        }
        if (generation !== this.restoreGeneration) return
        const tab = state.tabs[index]
        if ('sessionId' in tab) {
          try {
            const presenter = new NodeChatPresenter(tab, NodeService.getInstance().connection(tab.registrationId))
            publish(index, presenter)
            // Offline cache restoration must not wait for network admission.
            void presenter.load().catch((error: unknown) => console.error('[Abele] Node history could not be loaded', error))
          } catch (error) { console.error('[Abele] Node tab could not be restored', error) }
          continue
        }
        if (!tab.chatFilePath) {
          publish(index, new ChatSession(this))
          continue
        }

        const file = app.vault.getAbstractFileByPath(tab.chatFilePath)
        if (!(file instanceof TFile)) continue

        let created: ChatSession | null = null
        try {
          const session = await this.loadFile(file, () => {
            created = new ChatSession(this)
            this.sessions.set(created.id, created)
            return created
          })
          if (generation !== this.restoreGeneration) return
          if (session) publish(index, session)
        } catch (e) {
          console.error(`[Abele] Failed to restore tab ${tab.chatFilePath}:`, e)
          if (created) {
            const session = created as ChatSession
            session.destroy()
            this.sessions.delete(session.id)
            this.tabOrder.value = this.tabOrder.value.filter((id) => id !== session.id)
          }
          if (generation !== this.restoreGeneration) return
        }
      }

      if (!this.tabOrder.value.length) this.createTab()
    } catch (e) {
      console.error('[Abele] Failed to parse saved tabs:', e)
      if (generation === this.restoreGeneration && this.sessions.size === 0) this.createTab()
    } finally {
      if (generation === this.restoreGeneration) {
        this.restoringTabs = false
        this.saveTabs()
      }
    }
  }

  /** Persist current tabs state to localStorage */
  saveTabs(): void {
    // An early selection/save must not persist just the hydrated prefix and lose pending tabs.
    if (this.restoringTabs) return
    const state: TabsState = {
      tabs: this.tabOrder.value
        .filter((id) => !this.runTabs.has(id))
        .map((id) => {
          return this.getPresentation(id)?.reference ?? { kind: 'local-chat', chatFilePath: null }
        }),
      activeIndex: this.activeTabId.value ? this.tabOrder.value.indexOf(this.activeTabId.value) : 0,
    }
    GlobalStore.getInstance().app.saveLocalStorage(STORAGE_KEY, state)
  }

  // ── Session / tab management ──────────────────────────────────

  createTab(): string {
    if (!this.canCreateTab) {
      // Return active tab if at limit
      return this.activeTabId.value
    }
    const session = new ChatSession(this)
    this.sessions.set(session.id, session)
    this.tabOrder.value = [...this.tabOrder.value, session.id]
    this.activeTabId.value = session.id
    if (this.tabsRestored) this.saveTabs()
    return session.id
  }

  /** Puts the cursor in the composer of the chat in front, once it is on screen. */
  requestFocus(): void {
    this.focusRequest.value++
  }

  /**
   * The + in the tab bar: a new tab, with the cursor in it. `createTab` alone asks for no
   * cursor, because it is also what restoring the layout at startup makes its tabs with, and
   * that should not pull the cursor out of the note somebody is opening the app to.
   */
  newTab(): string {
    const id = this.createTab()
    this.requestFocus()
    return id
  }

  /**
   * "New chat", from a tab.
   *
   * An ordinary chat starts again in place, which is what that button has always done. A
   * comment cannot: its session writes the file a marker in a note points at, and `reset`
   * would empty that file and leave the icon leading to nothing. So the same act — a new
   * conversation — happens in a tab of its own, and the comment is left where it was.
   */
  async startNewChat(tabId: string): Promise<void> {
    const session = this.sessions.get(tabId)
    if (!session) return

    if (session.kind === 'comment') {
      this.newTab()
      return
    }

    await session.reset()
    this.requestFocus()
  }

  /**
   * "Open this chat", from a tab: into this one, or into a new one when this one is a comment.
   *
   * A chat already open somewhere is switched to rather than loaded twice — two sessions on
   * one file are two writers on one log.
   */
  async openChatInTab(tabId: string, file: TFile): Promise<void> {
    const previous = this.sessions.get(tabId)
    const session = await this.loadFile(file, () => {
      const holder = this.sessions.get(tabId)
      // A comment belongs to its marker; an in-flight load has already reserved its holder.
      if (holder && holder.kind !== 'comment' && !this.isLoading(holder)) return holder
      if (!this.canCreateTab) {
        new Notice(ChatService.TABS_FULL)
        return null
      }
      return this.sessions.get(this.createTab()) ?? null
    })
    if (session) this.selectLoaded(session, previous)
  }

  /**
   * Takes a session somebody else built and shows it as a tab.
   *
   * The limit is applied here as it is anywhere else. It used to be waived, on the reasoning
   * that this is only ever reached by an explicit act — but a phone hides the tab strip, so
   * the tabs an explicit act piles up are tabs nobody can see, reach or close. Refused out
   * loud instead: the caller has a card or a marker in front of the person, and a silent
   * no-op there looks exactly like something that opened out of sight.
   */
  /** What a person is told when the bar will take no more; said by whoever asked first. */
  static readonly TABS_FULL = `Close one of the ${MAX_TABS} open tabs first`

  /**
   * Whether this session could be shown as a tab right now — it already is one, or there is
   * room for one more.
   *
   * Asked before a move that cannot be undone: `expand` rewrites the file and the history and
   * only then hands the session over, so the refusal has to be available before any of that.
   * Silent, unlike `adoptSession`: nothing has been attempted yet.
   */
  hasRoomFor(session: ChatSession): boolean {
    return this.sessions.has(session.id) || this.canCreateTab
  }

  adoptSession(session: ChatSession): boolean {
    if (this.sessions.has(session.id)) {
      this.switchTab(session.id)
      return true
    }

    if (!this.canCreateTab) {
      new Notice(ChatService.TABS_FULL)
      return false
    }

    this.sessions.set(session.id, session)
    this.tabOrder.value = [...this.tabOrder.value, session.id]
    this.activeTabId.value = session.id
    this.saveTabs()
    return true
  }

  /**
   * Whether the chat sidebar is on screen: its leaf exists, its tab is the one in front of its
   * pane, and the pane is not collapsed. `isShown` answers all three at once — a collapsed
   * split hides the leaf's element like a tab behind another does — and it is what a marker in
   * a note asks before painting itself open over the passage its comment is about.
   */
  sidebarShowing(): boolean {
    // Optional on purpose: nothing to see is the answer where there is no workspace to ask,
    // which is the case in tests that stand the app up without one.
    const { workspace } = GlobalStore.getInstance().app
    const leaf = workspace?.getLeavesOfType?.(AI_SIDEBAR_VIEW_TYPE)[0]
    return !!leaf && leaf.view.containerEl.isShown()
  }

  /** Puts the chat sidebar in front of the person, opening it in the right split if needed. */
  /**
   * `focus: false` for a caller that opens something of its own over the chat — the find bar,
   * the history's search — which takes the cursor itself.
   */
  async revealSidebar({ focus = true }: { focus?: boolean } = {}): Promise<void> {
    // The shared adapter waits for the reveal and repairs a mobile drawer that finished
    // closing after its leaf was recreated. Returning earlier exposes a hidden, zero-size chat.
    await revealSidebarView(GlobalStore.getInstance().app, AI_SIDEBAR_VIEW_TYPE)

    // A blank chat is there to be typed into, so it gets the cursor as it comes into view. A
    // conversation does not: on a phone the cursor brings up the keyboard, which would cover
    // the half of what was opened to be read.
    if (focus && ChatService.isBlank(this.activeSession.value)) this.requestFocus()
  }

  /**
   * Nothing would be lost by starting over in it: an ordinary chat, never saved, with no
   * messages and no turn under way.
   */
  private static isBlank(s: ChatSession | null | undefined): s is ChatSession {
    return (
      !!s &&
      s.kind === 'chat' &&
      !s.currentChatFile.value &&
      s.allMessages.value.length === 0 &&
      !s.isStreaming.value
    )
  }

  async closeTab(tabId: string): Promise<void> {
    if (this.runTabs.has(tabId)) {
      this.closeRunTab(tabId)
      return
    }

    const node = this.nodeSessions.get(tabId)
    if (node) {
      node.destroy()
      this.dropTab(tabId)
      return
    }
    const session = this.sessions.get(tabId)
    if (!session) return

    // A comment being read here is not this tab's to end: it belongs to a note, and its
    // session goes on writing the same file and painting its marker. The × hands it back.
    const comments = CommentService.getInstance()
    const commentId = session.commentId
    if (session.kind === 'comment' && commentId && comments.isShown(commentId)) {
      await comments.hideFromSidebar(commentId)
      return
    }

    // Save before closing
    await session.save()
    session.destroy()
    this.dropTab(tabId)
  }

  /**
   * Deletes the conversation a tab is holding: the file, its delegated runs, its entry in the
   * index, and the tab itself.
   *
   * The order is the point. The session is destroyed *before* the file goes — it saves on a
   * timer and at the end of every turn, so one left alive over a deleted path writes the whole
   * conversation back a moment later. And nothing is saved on the way out, unlike `closeTab`:
   * this is somebody throwing the chat away.
   *
   * An expanded comment leaves through `CommentService` instead. Its marker is still in a
   * note, and an icon in the text that opens nothing is worse than the chat it points at.
   *
   * Answers whether anything was deleted: a tab nobody has written to has no file yet.
   */
  async deleteChat(tabId: string): Promise<boolean> {
    const session = this.sessions.get(tabId)
    if (!session) return false

    // A comment read in its tab goes the same way: deleting its file alone left its marker in
    // the note, an icon that opened nothing.
    const comments = CommentService.getInstance()
    const commentId = session.commentId
    if (commentId && (comments.isExpanded(commentId) || comments.isShown(commentId))) {
      await comments.remove(commentId)
      return true
    }

    const path = session.currentChatFile.value?.path
    if (!path) return false

    // Asked on this chat's answers, reachable only from them: they go with it, while the chat
    // can still say which they are.
    await comments.removeCommentsOn(path)

    this.dropTab(tabId)
    session.destroy()
    await ChatStorage.getInstance().deleteChat(path)
    return true
  }

  /**
   * Gives a session back to whoever built it, without ending the conversation in it.
   *
   * `closeTab` saves and then destroys, which is right for a chat somebody is finished with.
   * A comment going back to its margin is not finished: the same session goes on writing the
   * same file as a card, so it is only dropped from the tabs here. Saved first all the same —
   * the tab bar is where its last edits were made.
   */
  async releaseSession(tabId: string): Promise<void> {
    const session = this.sessions.get(tabId)
    if (!session) return

    await session.save()
    this.dropTab(tabId)
  }

  /**
   * Takes a tab out of the bar, saving nothing and destroying nothing.
   *
   * The half of closing and releasing that is only about the bar itself. Its own method
   * because a comment whose file has just been deleted needs exactly this and neither of the
   * others: there is nothing left to save it into, and the session is destroyed elsewhere.
   */
  dropTab(tabId: string): void {
    const removed = this.sessions.delete(tabId) || this.nodeSessions.delete(tabId)
    if (!removed) return
    this.tabOrder.value = this.tabOrder.value.filter((id) => id !== tabId)

    // Always keep at least one tab: an empty tab bar is a sidebar showing nothing at all.
    if (this.tabOrder.value.length === 0) {
      this.createTab()
      return
    }

    if (this.activeTabId.value === tabId) {
      this.activeTabId.value = this.tabOrder.value[this.tabOrder.value.length - 1]
    }
    this.saveTabs()
  }

  switchTab(tabId: string): void {
    if (this.runTabs.has(tabId)) {
      this.activeTabId.value = tabId
      return
    }
    if (this.sessions.has(tabId) || this.nodeSessions.has(tabId)) {
      this.activeTabId.value = tabId
      this.saveTabs()
    }
  }

  getSession(tabId: string): ChatSession | null {
    return this.sessions.get(tabId) ?? null
  }

  getNodeSession(tabId: string): NodeChatPresenter | null { return this.nodeSessions.get(tabId) ?? null }

  getPresentation(tabId: string): ChatPresentationSession | null {
    const node = this.nodeSessions.get(tabId)
    if (node) return node
    const local = this.sessions.get(tabId)
    return local ? new LocalChatPresenter(local) : null
  }

  async openNodeSession(reference: Extract<ChatReference, { kind: 'node-session' }>): Promise<void> {
    const id = `node:${reference.registrationId}:${reference.sessionId}`
    if (this.nodeSessions.has(id)) { this.switchTab(id); return }
    if (!this.canCreateTab) { new Notice(ChatService.TABS_FULL); return }
    const presenter = new NodeChatPresenter(reference, NodeService.getInstance().connection(reference.registrationId))
    this.nodeSessions.set(id, presenter)
    this.tabOrder.value = [...this.tabOrder.value, id]
    this.activeTabId.value = id
    this.saveTabs()
    await presenter.load()
  }

  // ── Run tabs ──────────────────────────────────────────────────

  getRun(tabId: string): RunFile | null {
    return this.runTabs.get(tabId) ?? null
  }

  isRunTab(tabId: string): boolean {
    return this.runTabs.has(tabId)
  }

  /** The run shown in the active tab, if the active tab is a run. */
  get activeRun(): RunFile | null {
    return this.activeTabId.value ? (this.runTabs.get(this.activeTabId.value) ?? null) : null
  }

  /** Opens a delegated run in its own tab, or switches to it if already open. */
  async openRun(runId: string): Promise<boolean> {
    for (const [tabId, run] of this.runTabs) {
      if (run.runId === runId) {
        this.activeTabId.value = tabId
        return true
      }
    }

    const run = await RunStorage.getInstance().load(runId)
    if (!run) return false

    const tabId = `run:${runId}`
    this.runTabs.set(tabId, run)
    this.tabOrder.value = [...this.tabOrder.value, tabId]
    this.activeTabId.value = tabId
    return true
  }

  private closeRunTab(tabId: string): void {
    this.runTabs.delete(tabId)
    this.tabOrder.value = this.tabOrder.value.filter((id) => id !== tabId)

    if (this.activeTabId.value === tabId) {
      this.activeTabId.value = this.tabOrder.value[this.tabOrder.value.length - 1] ?? null
    }
  }

  private isLoading(session: ChatSession): boolean {
    return [...this.loadingFiles.values()].some((load) => load.session === session)
  }

  /** Every entry point reserves the file before creating a holder or starting asynchronous I/O. */
  private loadFile(file: TFile, create: () => ChatSession | null): Promise<ChatSession | null> {
    const pending = this.loadingFiles.get(file.path)
    if (pending !== undefined) return pending.ready
    const existing = this.getSessionByFile(file.path)
    if (existing) return Promise.resolve(existing)

    let complete!: (session: ChatSession | null) => void
    let fail!: (error: unknown) => void
    const ready = new Promise<ChatSession | null>((resolve, reject) => {
      complete = resolve
      fail = reject
    })
    const entry = { session: null as ChatSession | null, ready }
    this.loadingFiles.set(file.path, entry)
    const generation = this.restoreGeneration
    void (async () => {
      try {
        // CommentService may already own a writer loaded by a note's editor. All tab entry
        // points use that handover, under the same reservation as ordinary chat loads.
        const comments = CommentService.getInstance()
        const comment = comments.isCommentFile(file)
        if (comment && !this.canCreateTab) {
          new Notice(ChatService.TABS_FULL)
          complete(null)
          return
        }
        const session = (entry.session = comment
          ? await comments.handOverToTab(file.basename)
          : create())
        if (!session) {
          complete(null)
          return
        }
        if (!comment) await session.load(file)
        if (
          generation !== this.restoreGeneration ||
          (!comment && this.sessions.get(session.id) !== session)
        ) {
          session.destroy()
          complete(null)
        } else {
          this.sessions.set(session.id, session)
          complete(session)
        }
      } catch (error) {
        fail(error)
      } finally {
        if (this.loadingFiles.get(file.path) === entry) this.loadingFiles.delete(file.path)
      }
    })()
    return ready
  }

  private selectLoaded(session: ChatSession, previous?: ChatSession | null): void {
    // Adopting a comment does not use the blank holder supplied by the caller. Remove only
    // a genuinely empty placeholder, never a draft or an existing conversation.
    if (
      previous &&
      previous !== session &&
      session.kind === 'comment' &&
      ChatService.isBlank(previous) &&
      !previous.draft.value.text &&
      !previous.draft.value.attachments.length &&
      !previous.draft.value.imports
    ) {
      previous.destroy()
      this.sessions.delete(previous.id)
      this.tabOrder.value = this.tabOrder.value.filter((id) => id !== previous.id)
    }
    if (!this.tabOrder.value.includes(session.id))
      this.tabOrder.value = [...this.tabOrder.value, session.id]
    this.switchTab(session.id)
  }

  getSessionByFile(filePath: string): ChatSession | null {
    for (const session of this.sessions.values()) {
      if (session.currentChatFile.value?.path === filePath) {
        return session
      }
    }
    return null
  }

  /** Open a chat file in the sidebar: reuse existing tab, load into empty tab, or create new */
  async openChatFile(file: TFile): Promise<void> {
    const previous = this.activeSession.value
    const session = await this.loadFile(file, () => {
      const active = this.activeSession.value
      if (active && !active.currentChatFile.value && !this.isLoading(active)) return active
      // createTab returns the active id at the limit; never load over that conversation.
      if (!this.canCreateTab) {
        new Notice(ChatService.TABS_FULL)
        return null
      }
      return this.sessions.get(this.createTab()) ?? null
    })
    if (session) this.selectLoaded(session, previous)
  }

  /**
   * A fresh chat on the default agent, in front: a blank tab already open is used rather than
   * another one added — the active one first — and a new tab is made only when there is none.
   *
   * Blank means nothing would be lost: an ordinary chat, never saved, with no messages. It is
   * reset all the same, so it starts on the default agent with none of the changes somebody
   * made to it. `null` when every tab holds a conversation and the bar will take no more; the
   * person is told why.
   */
  async openBlankChat(): Promise<ChatSession | null> {
    const isBlank = ChatService.isBlank
    const active = this.activeSession.value
    let session: ChatSession | null = isBlank(active)
      ? active
      : (this.tabOrder.value.map((id) => this.sessions.get(id)).find(isBlank) ?? null)

    if (session) {
      await session.reset()
    } else {
      if (!this.canCreateTab) {
        new Notice(ChatService.TABS_FULL)
        return null
      }
      session = this.sessions.get(this.createTab()) ?? null
      if (!session) return null
    }

    this.switchTab(session.id)
    return session
  }

  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values())
  }

  get canCreateTab(): boolean {
    return this.tabOrder.value.length < MAX_TABS
  }

  // ── Shared model config ───────────────────────────────────────

  getActiveModelConfig(): ModelConfig {
    const config = AbeleConfig.getInstance().ai

    let provider = config.providers.find((p) => p.id === config.activeProviderId)
    if (!provider || provider.models.length === 0) {
      provider = config.providers.find((p) => p.models.length > 0)
    }
    if (!provider) throw new Error('No provider with models configured')

    let model = provider.models.find((m) => m.id === config.activeModelId)
    if (!model) {
      model = provider.models[0]
    }

    return {
      id: model.id,
      name: model.name,
      baseUrl: provider.baseUrl,
      requestTimeoutSeconds: config.requestTimeoutSeconds,
      ...providerKey(provider.apiKeyId, provider.baseUrl, AbeleConfig.getInstance()),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      supportsReasoning: model.supportsReasoning,
      reasoningEffort: model.reasoningEffort,
    }
  }

  /**
   * The model for the plugin's own background work on a chat — naming it, compacting it.
   *
   * Asked in order: what the agent says, then the plugin-wide setting, then the model the chat
   * is already talking to. That last step is the point: this used to fall through to the
   * globally "active" model, which itself falls back to the first model of the first provider,
   * so a chat could have its title written by a model nobody chose for anything.
   *
   * The chat is optional because the old signature had no argument, and the plugin has one
   * caller — the background prompts screen — with no chat in hand.
   */
  getAuxiliaryModelConfig(session?: ChatSession): ModelConfig {
    const config = AbeleConfig.getInstance().ai

    const agent = session?.agent.value
    if (agent) {
      const ownChoice = AgentRegistry.getInstance().resolveModel(agent, { background: true })
      if (ownChoice) return ownChoice
    }

    const choice = config.auxiliaryModelId ?? ''
    const [providerId, modelId] = choice.includes('::') ? choice.split('::') : ['', choice]
    for (const provider of choice ? config.providers : []) {
      if (providerId && provider.id !== providerId) continue
      const model = provider.models.find((m) => m.id === modelId)
      if (model) {
        return {
          id: model.id,
          name: model.name,
          baseUrl: provider.baseUrl,
          requestTimeoutSeconds: config.requestTimeoutSeconds,
          ...providerKey(provider.apiKeyId, provider.baseUrl, AbeleConfig.getInstance()),
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          supportsReasoning: model.supportsReasoning,
        }
      }
    }

    return session?.activeModel() ?? this.getActiveModelConfig()
  }

  // ── System prompt ─────────────────────────────────────────────

  async getSystemPrompt(session: ChatSession): Promise<string> {
    return this.withCommentContext(session, await this.basePrompt(session))
  }

  /**
   * A comment is told where it sits, after whatever prompt it runs on.
   *
   * Rebuilt on every turn from the note as it is now: a comment that answered about a passage
   * the person has since rewritten is worse than no comment at all.
   */
  private async withCommentContext(session: ChatSession, prompt: string): Promise<string> {
    if (session.kind !== 'comment') return prompt
    const anchor = session.anchor.value
    if (!anchor) return prompt

    if (anchor.message) {
      // On an answer in a chat: the chat as it is now, filtered to what was said in it.
      const { app } = GlobalStore.getInstance()
      const chat = app.vault.getAbstractFileByPath(anchor.note)
      const content = chat instanceof TFile ? await app.vault.cachedRead(chat) : null
      // A comment on a comment is also told the levels above, by their quotes alone.
      const lineage = await CommentService.getInstance().lineage(anchor)
      return `${prompt}\n\n${buildMessageCommentContext(anchor, content, lineage)}`
    }

    if (anchor.cfi) {
      // In a book: the words and the text around them, read out of the book every turn.
      const { bookDiscussionContext } = await import('@/reader/bookDiscussions')
      return `${prompt}\n\n${await bookDiscussionContext(anchor)}`
    }

    const noteText = await this.readCommentNote(anchor.note)
    return `${prompt}\n\n${buildCommentContext(anchor, noteText, session.commentId ?? undefined)}`
  }

  /** The note's body, frontmatter dropped. Empty when it has been deleted under the comment. */
  private async readCommentNote(path: string): Promise<string> {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return ''
    return getNoteBody(await app.vault.cachedRead(file))
  }

  private async basePrompt(session: ChatSession): Promise<string> {
    const date = dayjs().format('YYYY-MM-DD')

    // The session's own agent — not the default one. Resolved on every call rather than
    // cached, so editing the agent in settings reaches a chat already in progress.
    const registry = AgentRegistry.getInstance()
    const agent = session.agent.value ?? registry.defaultAgent()

    // An overridden prompt replaces the agent's instructions, not what it was asked to
    // remember: the chat still runs on that agent, and the person asked *it*.
    const withMemory = (prompt: string): string => {
      const memory = agent ? registry.memoryPrompt(agent) : ''
      return memory ? `${prompt}\n\n${memory}` : prompt
    }

    // Per-chat override: note path
    if (session.customSystemPromptNotePath.value) {
      const body = await this.readNoteBody(session.customSystemPromptNotePath.value)
      if (body) return withMemory(body.replace(/\{\{date\}\}/g, date))
    }

    // Per-chat override: inline text
    if (session.customSystemPrompt.value) {
      return withMemory(session.customSystemPrompt.value.replace(/\{\{date\}\}/g, date))
    }

    if (agent) {
      const composed = await registry.buildSystemPrompt(agent)
      if (composed) return composed
    }

    // No agent configured at all — migration should have prevented this, but a settings file
    // edited by hand can still reach here, and a mute assistant is worse than a generic one.
    return DEFAULT_AI_SETTINGS.prompts.system.replace(/\{\{date\}\}/g, date)
  }

  private async readNoteBody(path: string): Promise<string | null> {
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return null
    const content = await app.vault.cachedRead(file)
    return getNoteBody(content).trim() || null
  }

  /** Resolve model config for specific provider+model IDs (used by per-session model) */
  getModelConfigFor(providerId: string, modelId: string): ModelConfig {
    const config = AbeleConfig.getInstance().ai

    let provider = config.providers.find((p) => p.id === providerId)
    if (!provider || provider.models.length === 0) {
      provider = config.providers.find((p) => p.models.length > 0)
    }
    if (!provider) throw new Error('No provider with models configured')

    let model = provider.models.find((m) => m.id === modelId)
    if (!model) {
      model = provider.models[0]
    }

    return {
      id: model.id,
      name: model.name,
      baseUrl: provider.baseUrl,
      ...providerKey(provider.apiKeyId, provider.baseUrl, AbeleConfig.getInstance()),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      supportsReasoning: model.supportsReasoning,
      reasoningEffort: model.reasoningEffort,
      requestTimeoutSeconds: config.requestTimeoutSeconds,
    }
  }

  // ── Model switching ───────────────────────────────────────────

  switchModel(providerId: string, modelId: string): void {
    const session = this.activeSession.value
    if (session) {
      session.activeProviderId.value = providerId
      session.activeModelId.value = modelId
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────

  destroy(): void {
    this.restoreGeneration++
    this.continueRestore?.()
    this.continueRestore = null
    this.restoringTabs = false
    this.loadingFiles.clear()
    for (const session of this.sessions.values()) {
      // Obsidian's unload is synchronous, so this cannot be awaited. Writes are deferred by
      // a fraction of a second at most, and a turn ends with one, so what is at risk here is
      // a partial turn — and starting it is what the flush is for.
      void session.flush()
      session.destroy()
    }
    this.sessions.clear()
    for (const presenter of this.nodeSessions.values()) presenter.destroy()
    this.nodeSessions.clear()
    NodeService.destroyCurrent()
    this.runTabs.clear()
    this.tabOrder.value = []
    this.activeTabId.value = null
    ChatService.instance = null
  }
}
