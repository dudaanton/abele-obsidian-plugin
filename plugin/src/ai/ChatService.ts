import { providerKey } from '@/secrets/destinations'
import { TabIntentQueue, type TabIntent } from './TabIntentQueue'
import { ref, computed, shallowRef, toRaw } from 'vue'
import { nanoid } from 'nanoid'
import { copyChatData } from './chatClone'
import { serializeChat } from './ChatLog'
import type { ChatMessage } from './types'
import { App, Notice, TFile } from 'obsidian'
import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ModelConfig } from './client'
import { DEFAULT_AI_SETTINGS } from './types'
import { requestTimeoutSeconds } from './requestTimeout'
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

interface FileOpenRequest {
  create: () => ChatSession | null
  current?: () => boolean
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
  private readonly presentations = new TabIntentQueue()
  private readonly presentationGuards = new WeakMap<() => boolean, TabIntent>()
  private readonly contextualLoads = new WeakMap<TFile, TabIntent>()
  private readonly releaseSaves = new WeakMap<ChatSession, Promise<void>>()
  private readonly tabReservations = new Set<ChatSession>()
  private loadingFiles = new Map<
    string,
    {
      session: ChatSession | null
      ready: Promise<ChatSession | null>
      requests: Map<symbol, FileOpenRequest>
    }
  >()
  /** Explicit tab choices invalidate delayed navigation; releasing a contextual tab does not. */
  private tabSelectionRevision = 0
  get tabSelectionVersion(): number {
    return this.tabSelectionRevision
  }

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
  public readonly pendingAttentionReveal = ref<{
    sessionId: string
    kind: import('@/agents/attention').AttentionReason['kind']
    id: string
    focusComposer?: boolean
  } | null>(null)
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
      this.mutatePresentation(() => this.createTabNow())
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
      if (this.sessions.size === 0) this.mutatePresentation(() => this.createTabNow())
      return
    }

    // Clear any tabs created before restore as one presentation mutation.
    this.mutatePresentation(() => {
      for (const session of this.sessions.values()) session.destroy()
      this.sessions.clear()
      for (const presenter of this.nodeSessions.values()) presenter.destroy()
      this.nodeSessions.clear()
      this.tabOrder.value = []
      this.activeTabId.value = null
    })

    this.restoringTabs = true
    try {
      if (!state.tabs?.length) {
        this.mutatePresentation(() => this.createTabNow())
        return
      }

      const activeIndex = Math.max(0, Math.min(state.activeIndex || 0, state.tabs.length - 1))
      const order = [activeIndex, ...state.tabs.map((_, i) => i).filter((i) => i !== activeIndex)]
      const slots: Array<string | undefined> = []
      const publish = (index: number, session: ChatSession | NodeChatPresenter) => this.mutatePresentation(() => {
        if (generation !== this.restoreGeneration || (session instanceof ChatSession && session.isDestroyed)) return false
        if (!this.tabOrder.value.includes(session.id) && !this.canCreateTab) return false
        slots[index] = session.id
        if (session instanceof NodeChatPresenter) this.nodeSessions.set(session.id, session)
        else this.sessions.set(session.id, session)
        const restored = slots.filter((id): id is string => !!id && (this.sessions.has(id) || this.nodeSessions.has(id)))
        // Tabs opened while restoration was reading stay after the saved layout.
        this.tabOrder.value = [...new Set([...restored, ...this.tabOrder.value])]
        // Select once. Background hydration must not steal a later user selection.
        if (!this.activeTabId.value) this.activeTabId.value = session.id
        if (session instanceof ChatSession)
          CommentService.getInstance().showPresentationNow(session, this.activeTabId.value === session.id)
        return true
      })

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
            if (!publish(index, presenter)) { presenter.destroy(); continue }
            // Offline cache restoration must not wait for network admission.
            void presenter.load().catch((error: unknown) => console.error('[Abele] Node history could not be loaded', error))
          } catch (error) { console.error('[Abele] Node tab could not be restored', error) }
          continue
        }
        if (!tab.chatFilePath) {
          const session = new ChatSession(this)
          if (!publish(index, session)) session.destroy()
          continue
        }

        const file = app.vault.getAbstractFileByPath(tab.chatFilePath)
        if (!(file instanceof TFile)) continue

        let created: ChatSession | null = null
        try {
          const session = await this.loadFile(file, () => {
            created = new ChatSession(this)
            return created
          })
          if (generation !== this.restoreGeneration) return
          if (session && !publish(index, session) && !session.commentId && !this.sessions.has(session.id))
            session.destroy()
        } catch (e) {
          console.error(`[Abele] Failed to restore tab ${tab.chatFilePath}:`, e)
          if (created) {
            const session = created as ChatSession
            this.mutatePresentation(() => {
              session.destroy()
              this.sessions.delete(session.id)
              this.tabOrder.value = this.tabOrder.value.filter((id) => id !== session.id)
            })
          }
          if (generation !== this.restoreGeneration) return
        }
      }

      if (!this.tabOrder.value.length) this.mutatePresentation(() => this.createTabNow())
    } catch (e) {
      console.error('[Abele] Failed to parse saved tabs:', e)
      if (generation === this.restoreGeneration && this.sessions.size === 0)
        this.mutatePresentation(() => this.createTabNow())
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
    const intent = this.presentations.begin('new-tab', false)
    return this.presentations.apply(intent, () => this.createTabNow()) ?? this.activeTabId.value!
  }

  private createTabNow(select = true): string {
    if (!this.canCreateTab) {
      // Return active tab if at limit
      return this.activeTabId.value
    }
    const session = new ChatSession(this)
    this.sessions.set(session.id, session)
    this.tabOrder.value = [...this.tabOrder.value, session.id]
    if (select) this.activeTabId.value = session.id
    if (this.tabsRestored) this.saveTabs()
    return session.id
  }

  /** Create an independent file in a new tab, without sending anything. */
  async cloneChatFromMessage(tabId: string, messageId: string): Promise<void> {
    const source = this.sessions.get(tabId)
    if (!source) return // Node histories have no local-chat clone action.
    if (!this.canCreateTab) {
      new Notice(ChatService.TABS_FULL)
      return
    }
    const snapshot = source.cloneSnapshot(messageId)
    if (!snapshot) return
    // Reserve the tab before any asynchronous writes: never fall back to the source at limit.
    const cloneId = this.createTab()
    const clone = this.sessions.get(cloneId)!
    clone.preparingClone.value = true
    const version = clone.conversationVersion.value
    const isCurrent = () => this.sessions.get(cloneId) === clone && clone.conversationVersion.value === version
    const storage = ChatStorage.getInstance()
    const runs = RunStorage.getInstance()
    const copies: RunFile[] = []
    const stillOpen = () => {
      if (this.sessions.get(cloneId) !== clone) throw new Error('The new chat tab was closed.')
      if (!isCurrent() || !clone.preparingClone.value) throw new Error('The chat copy was cancelled.')
    }
    let file: TFile | null = null
    try {
      const copyRuns = async (messages: ChatMessage[], parentChat: string) => {
        for (const message of messages) {
          const reference = message.subAgentRun
          if (!reference) continue
          const original = await runs.load(reference.runId, { readOnly: true })
          if (!original)
            throw new Error(
              'A delegated transcript is unavailable. Reopen the source chat and try again.'
            )
          const run = copyChatData(original)
          run.runId = nanoid()
          run.parentChat = parentChat
          run.parentToolCallId = message.toolCallId ?? message.id
          copies.push(run)
          for (const branch of run.branches)
            await copyRuns(branch.messages, runs.runPath(run.runId))
          message.subAgentRun = {
            ...reference,
            runId: run.runId,
            path: runs.runPath(run.runId),
            status: run.status,
          }
        }
      }
      await copyRuns(snapshot.messages, '')
      stillOpen()
      for (const run of copies)
        if (!(await runs.save(run))) throw new Error('Could not save a delegated transcript.')
      file = await storage.saveChat(snapshot, {
        kind: 'rewrite',
        content: serializeChat(snapshot),
        records: 1 + snapshot.messages.length + (snapshot.internalMessages?.length ?? 0),
      })
      if (!file) throw new Error('Could not save the new chat.')
      stillOpen()
      for (const run of copies.filter((run) => !run.parentChat)) {
        run.parentChat = file.path
        if (!(await runs.save(run))) throw new Error('Could not save a delegated transcript.')
      }
      stillOpen()
      await clone.initializeClone(file, isCurrent)
      stillOpen()
      clone.preparingClone.value = false
      clone.mirrorNoteLinks()
      this.saveTabs()
    } catch (error) {
      // Only independent copies: deleting a failed clone cannot delete source transcripts.
      if (file) await storage.deleteChat(file.path)
      await runs.deleteRuns(copies.map((run) => run.runId))
      // A tab reused by a later load belongs to that conversation now. Clean up only
      // this operation's files; never destroy or select over the replacement session.
      if (isCurrent()) {
        clone.preparingClone.value = false
        clone.destroy()
        this.dropTab(cloneId)
        if (this.sessions.has(tabId)) this.switchTab(tabId)
      }
      new Notice(
        `Could not create a new chat: ${error instanceof Error ? error.message : String(error)}`
      )
    }
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
    const intent = this.presentations.begin('new-tab', false)
    return this.presentations.apply(intent, () => {
      this.tabSelectionRevision++
      const id = this.createTabNow()
      this.requestFocus()
      return id
    }) ?? this.activeTabId.value!
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
    this.tabSelectionRevision++
    const intent = this.presentations.begin(file.path, false)
    const current = this.intentGuard(intent)
    const previous = this.sessions.get(tabId)
    const session = await this.loadFile(file, () => {
      const holder = this.sessions.get(tabId)
      // A comment belongs to its marker; an in-flight load has already reserved its holder.
      if (holder && holder.kind !== 'comment' && !this.isLoading(holder)) return holder
      if (!this.canCreateTab) {
        new Notice(ChatService.TABS_FULL)
        return null
      }
      return this.sessions.get(this.createTabNow(this.presentations.selected(intent))) ?? null
    }, current)
    if (session) await this.presentLoadedSession(intent, session, previous)
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
    return this.mutatePresentation(() => this.sessions.has(session.id) || this.canCreateTab) ?? false
  }

  /** Reserve capacity for an irreversible metadata promotion while its save runs outside the queue. */
  reserveTab(session: ChatSession): (() => void) | null {
    return this.presentations.mutateImmediate(() => {
      if (!this.sessions.has(session.id) && !this.canCreateTab) return null
      this.tabReservations.add(session)
      return () => { this.mutatePresentation(() => this.tabReservations.delete(session)) }
    }) ?? null
  }

  adoptSession(session: ChatSession, current?: () => boolean): boolean {
    const intent = (current && this.presentationGuards.get(current)) ??
      this.presentations.begin(session.currentChatFile.value?.path ?? session.id, true, current)
    if (!this.presentations.retarget(intent, session.currentChatFile.value?.path ?? session.id)) return false
    return this.presentations.apply(intent, () => {
      if (session.isDestroyed || !this.adoptSessionNow(session)) return false
      CommentService.getInstance().showPresentationNow(session)
      return true
    }) ?? false
  }

  private adoptSessionNow(session: ChatSession): boolean {
    if (this.sessions.has(session.id)) {
      this.switchTabNow(session.id)
      return true
    }

    if (!this.canCreateTab && !this.tabReservations.has(session)) {
      new Notice(ChatService.TABS_FULL)
      return false
    }

    this.tabSelectionRevision++
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
  async revealSidebar({ focus = true, current }: { focus?: boolean; current?: () => boolean } = {}): Promise<void> {
    // Revealing is a continuation, not a fresh tab-selection action. Unscoped callers can
    // reveal the current foreground, but can never supersede an opening already in flight.
    const intent = (current && this.presentationGuards.get(current)) ??
      this.presentations.captureForeground() ?? this.presentations.begin('sidebar', false, current)
    if (current && !current()) return
    if (!(await this.presentations.applyAsync(intent, () => this.presentations.selected(intent))) ||
      !this.presentations.selected(intent)) return
    // Workspace animation is I/O too. It cannot hold the tab queue or create a new intent
    // when it completes; only a still-current foreground action may request composer focus.
    await revealSidebarView(GlobalStore.getInstance().app, AI_SIDEBAR_VIEW_TYPE)
    this.presentations.apply(intent, () => {
      if (focus && (!current || current()) && this.presentations.selected(intent) && ChatService.isBlank(this.activeSession.value))
        this.requestFocus()
    })
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

    const intent = this.presentations.begin(session.currentChatFile.value?.path ?? tabId, false)
    await this.saveForRelease(session)
    this.presentations.apply(intent, () => {
      if (this.sessions.get(tabId) !== session || session.isDestroyed) return
      session.destroy()
      this.dropTabNow(tabId)
    })
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
  /** Only intent admission and atomic UI decisions run here; no disk/model work. */
  mutatePresentation<T>(work: () => T): T | undefined { return this.presentations.mutate(work) }

  private intentGuard(intent: TabIntent): () => boolean {
    const current = () => this.presentations.valid(intent)
    this.presentationGuards.set(current, intent)
    return current
  }

  isForegroundPresentation(current: () => boolean): boolean {
    const intent = this.presentationGuards.get(current)
    return !!intent && this.presentations.selected(intent)
  }

  contextualOpenGuard(target: ChatSession | string | null | undefined, current?: () => boolean): () => boolean {
    if (current && this.presentationGuards.has(current)) return current
    const key = typeof target === 'string' ? target : target?.currentChatFile.value?.path ?? target?.id ?? 'contextual-slot'
    return this.intentGuard(this.presentations.begin(key, true, current))
  }

  private saveForRelease(session: ChatSession): Promise<void> {
    const pending = this.releaseSaves.get(session)
    if (pending) return pending
    const saving = session.saveForRelease()
    this.releaseSaves.set(session, saving)
    void saving.finally(() => { if (this.releaseSaves.get(session) === saving) this.releaseSaves.delete(session) }).catch(() => {})
    return saving
  }

  async releaseSession(tabId: string, current?: () => boolean): Promise<boolean> {
    const session = this.sessions.get(tabId)
    if (!session) return false
    const intent = current && this.presentationGuards.get(current) ||
      this.presentations.begin(session.currentChatFile.value?.path ?? tabId, false, current)
    if (!(await this.presentations.applyAsync(intent, () => this.sessions.get(tabId) === session && !session.isDestroyed)) ||
      !this.presentations.valid(intent)) return false
    await this.saveForRelease(session)
    return await this.presentations.applyAsync(intent, () => {
      if (session.isDestroyed || this.sessions.get(tabId) !== session) return false
      this.dropTabNow(tabId)
      return true
    }) ?? false
  }

  /** Save outside the queue, then release/reuse the contextual slot and check capacity atomically. */
  async presentContextualSession(session: ChatSession, current: () => boolean, previous?: ChatSession | null): Promise<boolean> {
    const intent = this.presentationGuards.get(current)
    if (!intent) throw new Error('Contextual presentation requires an admitted intent.')
    if (!this.presentations.retarget(intent, session.currentChatFile.value?.path ?? session.id)) return false
    const comments = CommentService.getInstance()
    // An expanded discussion is an independent chat, never a replacement for the comment slot.
    if (session.kind !== 'comment') return this.presentLoadedSession(intent, session, previous)
    const contextualTabs = () => [...this.sessions.values()].filter((other) =>
      other !== session && other.kind === 'comment' && other.commentId && comments.isShown(other.commentId)
    )
    const saved = new Set<ChatSession>()
    while (current()) {
      const releases = await this.presentations.applyAsync(intent, () => contextualTabs().filter((other) => !saved.has(other)))
      if (!releases || !current()) return false
      await Promise.all(releases.map((other) => this.saveForRelease(other)))
      releases.forEach((other) => saved.add(other))
      const committed = await this.presentations.applyAsync(intent, () => {
        if (session.isDestroyed || session.moving.value) return false
        const actual = contextualTabs()
        // Restoration can hydrate another tab without being a user action. Extend this same
        // plan outside the queue; never drop an unsaved arrival or mint a new release intent.
        if (actual.some((other) => !saved.has(other))) return null
        if (!this.sessions.has(session.id) && this.occupiedTabCount - actual.length >= MAX_TABS) {
          new Notice(ChatService.TABS_FULL)
          return false
        }
        for (const other of actual) this.dropTabNow(other.id, false)
        if (!this.adoptSessionNow(session)) return false
        this.selectLoadedNow(session, previous)
        comments.showPresentationNow(session)
        return true
      })
      if (committed !== null) return committed ?? false
    }
    return false
  }

  /**
   * Takes a tab out of the bar, saving nothing and destroying nothing.
   *
   * The half of closing and releasing that is only about the bar itself. Its own method
   * because a comment whose file has just been deleted needs exactly this and neither of the
   * others: there is nothing left to save it into, and the session is destroyed elsewhere.
   */
  dropTab(tabId: string): void { this.mutatePresentation(() => this.dropTabNow(tabId)) }

  private dropTabNow(tabId: string, keepBlank = true): void {
    const session = this.sessions.get(tabId)
    const removed = this.sessions.delete(tabId) || this.nodeSessions.delete(tabId)
    if (!removed) return
    if (session) CommentService.getInstance().releasePresentationNow(session)
    this.tabOrder.value = this.tabOrder.value.filter((id) => id !== tabId)

    // Always keep at least one tab: an empty tab bar is a sidebar showing nothing at all.
    if (this.tabOrder.value.length === 0) {
      if (keepBlank) this.createTabNow()
      else this.activeTabId.value = null
      return
    }

    if (this.activeTabId.value === tabId) {
      this.activeTabId.value = this.tabOrder.value[this.tabOrder.value.length - 1]
    }
    this.saveTabs()
  }

  switchTab(tabId: string): void {
    this.tabSelectionRevision++
    const session = this.sessions.get(tabId)
    const intent = this.presentations.begin(session?.currentChatFile.value?.path ?? tabId, true)
    this.presentations.apply(intent, () => this.switchTabNow(tabId))
  }

  private switchTabNow(tabId: string): void {
    if (this.runTabs.has(tabId)) {
      this.tabSelectionRevision++
      this.activeTabId.value = tabId
      return
    }
    if (this.sessions.has(tabId) || this.nodeSessions.has(tabId)) {
      this.activeTabId.value = tabId
      const session = this.sessions.get(tabId)
      if (session?.kind === 'comment' && session.commentId)
        CommentService.getInstance().open.value = session.commentId
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
    this.tabSelectionRevision++
    const id = `node:${reference.registrationId}:${reference.sessionId}`
    const intent = this.presentations.begin(id, true)
    const presenter = this.presentations.apply(intent, () => {
      if (this.nodeSessions.has(id)) { this.switchTabNow(id); return null }
      if (!this.canCreateTab) { new Notice(ChatService.TABS_FULL); return null }
      const presenter = new NodeChatPresenter(reference, NodeService.getInstance().connection(reference.registrationId))
      this.nodeSessions.set(id, presenter)
      this.tabOrder.value = [...this.tabOrder.value, id]
      this.activeTabId.value = id
      this.saveTabs()
      return presenter
    })
    if (presenter) await presenter.load()
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
    this.tabSelectionRevision++
    const tabId = `run:${runId}`
    const intent = this.presentations.begin(tabId, true)
    if (this.presentations.apply(intent, () => {
      if (!this.runTabs.has(tabId)) return false
      this.switchTabNow(tabId)
      return true
    })) return true
    const run = await RunStorage.getInstance().load(runId)
    if (!run) return false
    return this.presentations.apply(intent, () => {
      this.runTabs.set(tabId, run)
      this.tabOrder.value = [...this.tabOrder.value, tabId]
      this.activeTabId.value = tabId
      return true
    }) ?? false
  }

  private closeRunTab(tabId: string): void {
    const intent = this.presentations.begin(tabId, false)
    this.presentations.apply(intent, () => {
      this.runTabs.delete(tabId)
      this.tabOrder.value = this.tabOrder.value.filter((id) => id !== tabId)
      if (this.activeTabId.value === tabId)
        this.activeTabId.value = this.tabOrder.value[this.tabOrder.value.length - 1] ?? null
    })
  }

  private isLoading(session: ChatSession): boolean {
    return [...this.loadingFiles.values()].some((load) => load.session === session)
  }

  /** Independent file opens reserve their intent before either discovery or reconciliation. */
  fileOpenGuard(file: TFile): () => boolean {
    return this.intentGuard(this.presentations.begin(file.path, false))
  }

  /** Shared file I/O has no contextual-tab effects; callers apply its result in the queue. */
  private loadFile(file: TFile, create: () => ChatSession | null, current?: () => boolean): Promise<ChatSession | null> {
    const request: FileOpenRequest = { create, current }
    const pending = this.loadingFiles.get(file.path)
    if (pending) { pending.requests.set(Symbol(), request); return pending.ready }
    const existing = this.getSessionByFile(file.path)
    if (existing) return existing.reconcileForSelectionReturn(current).then(() =>
      existing.isDestroyed || existing.currentChatFile.value?.path !== file.path ? null : existing
    )
    let complete!: (session: ChatSession | null) => void
    let fail!: (error: unknown) => void
    const ready = new Promise<ChatSession | null>((resolve, reject) => { complete = resolve; fail = reject })
    const entry = { session: null as ChatSession | null, ready, requests: new Map([[Symbol(), request]]) }
    this.loadingFiles.set(file.path, entry)
    const generation = this.restoreGeneration
    void (async () => {
      try {
        const prepared = await ChatStorage.getInstance().prepareDiscussion(file)
        let session: ChatSession | null = null
        if (prepared.identity) session = await CommentService.getInstance().load(prepared.identity, file)
        else {
          session = this.mutatePresentation(() => {
            for (const waiter of entry.requests.values()) {
              if (waiter.current && !waiter.current()) continue
              const holder = waiter.create()
              if (holder) return holder
            }
            return null
          }) ?? null
        }
        entry.session = session
        if (!session) { complete(null); return }
        if (!prepared.identity) await session.load(file)
        if (generation !== this.restoreGeneration) { session.destroy(); complete(null) }
        else complete(session)
      } catch (error) { fail(error) }
      finally { if (this.loadingFiles.get(file.path) === entry) this.loadingFiles.delete(file.path) }
    })()
    return ready
  }

  private selectLoadedNow(session: ChatSession, previous?: ChatSession | null): void {
    if (session.isDestroyed || this.sessions.get(session.id) !== session) return
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
    this.switchTabNow(session.id)
  }

  getSessionByFile(filePath: string): ChatSession | null {
    for (const session of this.sessions.values()) {
      if (session.currentChatFile.value?.path === filePath) {
        return session
      }
    }
    return null
  }

  /** A file link may replace a contextual tab instead of requiring additional capacity. */
  async openContextualChatFile(
    file: TFile,
    selectionReturn?: () => boolean,
    scopeCurrent?: () => boolean
  ): Promise<boolean> {
    const raw = toRaw(file)
    const inherited = scopeCurrent && this.presentationGuards.get(scopeCurrent)
    const intent = inherited ?? this.presentations.begin(file.path, true, scopeCurrent ?? selectionReturn)
    this.contextualLoads.set(raw, intent)
    let opening: Promise<void>
    try { opening = selectionReturn ? this.openChatFile(file, selectionReturn) : this.openChatFile(file) }
    finally { if (this.contextualLoads.get(raw) === intent) this.contextualLoads.delete(raw) }
    await opening
    return this.presentations.valid(intent) && !!this.getSessionByFile(file.path)
  }

  /** Open a chat file in the sidebar: reuse existing tab, load into empty tab, or create new */
  async openChatFile(file: TFile, selectionReturn?: () => boolean): Promise<void> {
    if (selectionReturn && !selectionReturn()) return
    this.tabSelectionRevision++
    const intent = this.contextualLoads.get(toRaw(file)) ??
      (selectionReturn && this.presentationGuards.get(selectionReturn)) ??
      this.presentations.begin(file.path, false, selectionReturn)
    // A link's file becomes authoritative only after identity resolution. Keep the original
    // action, but bind it to the same key used by closes before awaiting the shared writer.
    if (!this.presentations.retarget(intent, file.path)) return
    const current = this.intentGuard(intent)
    const previous = this.activeSession.value
    const session = await this.loadFile(file, () => {
      if (!current()) return null
      const active = this.activeSession.value
      if (ChatService.isBlank(active) && !this.isLoading(active)) return active
      if (!this.canCreateTab) { new Notice(ChatService.TABS_FULL); return null }
      return this.sessions.get(this.createTabNow(this.presentations.selected(intent))) ?? null
    }, current)
    if (!session || !current()) return
    if (selectionReturn) await session.reconcileForSelectionReturn(current)
    if (intent.contextual && session.kind === 'comment') {
      await this.presentContextualSession(session, current, previous)
      return
    }
    await this.presentLoadedSession(intent, session, previous)
  }

  /** Generic/attention opens keep independent tabs, but only the latest action selects one. */
  private async presentLoadedSession(intent: TabIntent, session: ChatSession, previous?: ChatSession | null): Promise<boolean> {
    return await this.presentations.applyAsync(intent, () => {
      if (session.isDestroyed || session.moving.value) return false
      if (!this.sessions.has(session.id) && !this.canCreateTab) { new Notice(ChatService.TABS_FULL); return false }
      this.sessions.set(session.id, session)
      if (!this.tabOrder.value.includes(session.id)) this.tabOrder.value = [...this.tabOrder.value, session.id]
      if (this.presentations.selected(intent)) this.selectLoadedNow(session, previous)
      CommentService.getInstance().showPresentationNow(session, this.presentations.selected(intent))
      this.saveTabs()
      return true
    }) ?? false
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
    const intent = this.presentations.begin('blank-chat', true)
    const isBlank = ChatService.isBlank
    const active = this.activeSession.value
    let session: ChatSession | null = isBlank(active)
      ? active
      : (this.tabOrder.value.map((id) => this.sessions.get(id)).find(isBlank) ?? null)

    if (session) {
      await session.reset()
    } else {
      session = this.presentations.apply(intent, () => {
        if (!this.canCreateTab) { new Notice(ChatService.TABS_FULL); return null }
        return this.sessions.get(this.createTabNow()) ?? null
      }) ?? null
      if (!session) return null
    }

    return this.presentations.apply(intent, () => {
      if (!session || session.isDestroyed) return null
      this.switchTabNow(session.id)
      return session
    }) ?? null
  }

  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values())
  }

  private get occupiedTabCount(): number {
    return this.tabOrder.value.length + [...this.tabReservations].filter((session) =>
      !this.tabOrder.value.includes(session.id)
    ).length
  }

  get canCreateTab(): boolean {
    return this.occupiedTabCount < MAX_TABS
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
      clientName: provider.clientName,
      requestTimeoutSeconds: requestTimeoutSeconds(
        model.requestTimeoutSeconds,
        config.requestTimeoutSeconds
      ),
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
          clientName: provider.clientName,
          requestTimeoutSeconds: requestTimeoutSeconds(
            model.requestTimeoutSeconds,
            config.requestTimeoutSeconds
          ),
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
      clientName: provider.clientName,
      ...providerKey(provider.apiKeyId, provider.baseUrl, AbeleConfig.getInstance()),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      supportsReasoning: model.supportsReasoning,
      reasoningEffort: model.reasoningEffort,
      requestTimeoutSeconds: requestTimeoutSeconds(
        model.requestTimeoutSeconds,
        config.requestTimeoutSeconds
      ),
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
    this.presentations.clear()
    this.tabReservations.clear()
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
