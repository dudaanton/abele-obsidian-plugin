import { ref, computed } from 'vue'
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
import { RunStorage, type RunFile } from './RunStorage'
import { AI_SIDEBAR_VIEW_TYPE } from '@/constants/views'
import { buildCommentContext } from './commentContext'

const MAX_TABS = 8
const STORAGE_KEY = 'abele-agent-tabs'

interface TabsState {
  tabs: Array<{ chatFilePath: string | null }>
  activeIndex: number
}

export class ChatService {
  private static instance: ChatService | null = null

  private sessions = new Map<string, ChatSession>()
  /**
   * Read-only tabs showing a delegated run.
   *
   * A run is a file, not a live session — nothing can be typed into it and nothing streams
   * from it, so it sits alongside the chat sessions rather than pretending to be one.
   */
  private runTabs = new Map<string, RunFile>()
  private tabsRestored = false
  public readonly activeTabId = ref<string | null>(null)
  public readonly tabOrder = ref<string[]>([])

  public readonly activeSession = computed<ChatSession | null>(() =>
    this.activeTabId.value ? (this.sessions.get(this.activeTabId.value) ?? null) : null
  )

  /** Text to pre-fill in chat input (consumed by AiChat component) */
  public readonly pendingInput = ref<string | null>(null)

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
    if (!this.tabsRestored && this.sessions.size === 0) {
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
    const { app } = GlobalStore.getInstance()
    const state = ChatService.loadTabsState(app)
    if (!state) {
      if (this.sessions.size === 0) this.createTab()
      return
    }

    // Clear any tabs created before restore
    for (const session of this.sessions.values()) session.destroy()
    this.sessions.clear()
    this.tabOrder.value = []
    this.activeTabId.value = null

    try {
      if (!state.tabs?.length) {
        this.createTab()
        return
      }

      let restoredAny = false

      for (const tab of state.tabs) {
        if (!tab.chatFilePath) {
          // Empty tab — just create a new one
          this.createTab()
          restoredAny = true
          continue
        }

        const file = app.vault.getAbstractFileByPath(tab.chatFilePath)
        if (!(file instanceof TFile)) continue

        // A comment file may already have a session on it: the note's editor initialises
        // before `onLayoutReady`, so a marker on screen has been read and loaded by the time
        // this runs. Building a second session here would put two log writers on one file.
        const comments = CommentService.getInstance()
        if (comments.isCommentFile(file)) {
          try {
            const adopted = await comments.handOverToTab(file.basename)
            if (!adopted) continue
            this.sessions.set(adopted.id, adopted)
            this.tabOrder.value = [...this.tabOrder.value, adopted.id]
            restoredAny = true
          } catch (e) {
            console.error(`[Abele] Failed to restore tab ${tab.chatFilePath}:`, e)
          }
          continue
        }

        const session = new ChatSession(this)
        this.sessions.set(session.id, session)
        this.tabOrder.value = [...this.tabOrder.value, session.id]

        try {
          await session.load(file)
        } catch (e) {
          console.error(`[Abele] Failed to restore tab ${tab.chatFilePath}:`, e)
          session.destroy()
          this.sessions.delete(session.id)
          this.tabOrder.value = this.tabOrder.value.filter((id) => id !== session.id)
          continue
        }

        restoredAny = true
      }

      if (!restoredAny) {
        this.createTab()
        return
      }

      // Restore active tab
      const activeIdx = Math.min(state.activeIndex, this.tabOrder.value.length - 1)
      this.activeTabId.value = this.tabOrder.value[Math.max(0, activeIdx)]
    } catch (e) {
      console.error('[Abele] Failed to parse saved tabs:', e)
      if (this.sessions.size === 0) this.createTab()
    }
  }

  /** Persist current tabs state to localStorage */
  saveTabs(): void {
    const state: TabsState = {
      tabs: this.tabOrder.value
        .filter((id) => !this.runTabs.has(id))
        .map((id) => {
          const session = this.sessions.get(id)
          return { chatFilePath: session?.currentChatFile.value?.path ?? null }
        }),
      activeIndex: this.activeTabId.value ? this.tabOrder.value.indexOf(this.activeTabId.value) : 0,
    }
    GlobalStore.getInstance().app.saveLocalStorage(STORAGE_KEY, state)
  }

  // ── Session / tab management ──────────────────────────────────

  createTab(): string {
    if (this.sessions.size >= MAX_TABS) {
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

  /**
   * Takes a session somebody else built and shows it as a tab.
   *
   * The limit is applied here as it is anywhere else. It used to be waived, on the reasoning
   * that this is only ever reached by an explicit act — but a phone hides the tab strip, so
   * the tabs an explicit act piles up are tabs nobody can see, reach or close. Refused out
   * loud instead: the caller has a card or a marker in front of the person, and a silent
   * no-op there looks exactly like something that opened out of sight.
   */
  adoptSession(session: ChatSession): boolean {
    if (this.sessions.has(session.id)) {
      this.switchTab(session.id)
      return true
    }

    if (this.sessions.size >= MAX_TABS) {
      new Notice(`Close one of the ${MAX_TABS} open tabs first`)
      return false
    }

    this.sessions.set(session.id, session)
    this.tabOrder.value = [...this.tabOrder.value, session.id]
    this.activeTabId.value = session.id
    this.saveTabs()
    return true
  }

  /** Puts the chat sidebar in front of the person, opening it in the right split if needed. */
  async revealSidebar(): Promise<void> {
    const { workspace } = GlobalStore.getInstance().app

    let leaf = workspace.getLeavesOfType(AI_SIDEBAR_VIEW_TYPE)[0] ?? null
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)
      await leaf.setViewState({ type: AI_SIDEBAR_VIEW_TYPE, active: true })
    }
    void workspace.revealLeaf(leaf)
  }

  async closeTab(tabId: string): Promise<void> {
    if (this.runTabs.has(tabId)) {
      this.closeRunTab(tabId)
      return
    }

    const session = this.sessions.get(tabId)
    if (!session) return

    // Save before closing
    await session.save()
    session.destroy()
    this.dropTab(tabId)
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
    if (!this.sessions.delete(tabId)) return
    this.tabOrder.value = this.tabOrder.value.filter((id) => id !== tabId)

    // Always keep at least one tab: an empty tab bar is a sidebar showing nothing at all.
    if (this.sessions.size === 0) {
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
    if (this.sessions.has(tabId)) {
      this.activeTabId.value = tabId
      this.saveTabs()
    }
  }

  getSession(tabId: string): ChatSession | null {
    return this.sessions.get(tabId) ?? null
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
    // Already open → switch to it
    const existing = this.getSessionByFile(file.path)
    if (existing) {
      this.switchTab(existing.id)
      return
    }

    // Current tab is empty (no file) → load there
    const active = this.activeSession.value
    if (active && !active.currentChatFile.value) {
      await active.load(file)
      this.saveTabs()
      return
    }

    // Create new tab and load
    const tabId = this.createTab()
    const session = this.sessions.get(tabId)
    if (session) {
      await session.load(file)
      this.saveTabs()
    }
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
      apiKey: GlobalStore.getInstance().app.secretStorage.getSecret(provider.apiKeyId) || '',
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

    for (const provider of config.auxiliaryModelId ? config.providers : []) {
      const model = provider.models.find((m) => m.id === config.auxiliaryModelId)
      if (model) {
        return {
          id: model.id,
          name: model.name,
          baseUrl: provider.baseUrl,
          apiKey: GlobalStore.getInstance().app.secretStorage.getSecret(provider.apiKeyId) || '',
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

    // Per-chat override: note path
    if (session.customSystemPromptNotePath.value) {
      const body = await this.readNoteBody(session.customSystemPromptNotePath.value)
      if (body) return body.replace(/\{\{date\}\}/g, date)
    }

    // Per-chat override: inline text
    if (session.customSystemPrompt.value) {
      return session.customSystemPrompt.value.replace(/\{\{date\}\}/g, date)
    }

    // The session's own agent — not the default one. Resolved on every call rather than
    // cached, so editing the agent in settings reaches a chat already in progress.
    const registry = AgentRegistry.getInstance()
    const agent = session.agent.value ?? registry.defaultAgent()
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
      apiKey: GlobalStore.getInstance().app.secretStorage.getSecret(provider.apiKeyId) || '',
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      supportsReasoning: model.supportsReasoning,
      reasoningEffort: model.reasoningEffort,
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
    for (const session of this.sessions.values()) {
      // Obsidian's unload is synchronous, so this cannot be awaited. Writes are deferred by
      // a fraction of a second at most, and a turn ends with one, so what is at risk here is
      // a partial turn — and starting it is what the flush is for.
      void session.flush()
      session.destroy()
    }
    this.sessions.clear()
    this.runTabs.clear()
    this.tabOrder.value = []
    this.activeTabId.value = null
    ChatService.instance = null
  }
}
