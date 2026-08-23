import { ref, computed } from 'vue'
import { TFile } from 'obsidian'
import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ModelConfig } from './client'
import { DEFAULT_AI_SETTINGS } from './types'
import { AgentRegistry } from './agents/AgentRegistry'
import { getNoteBody } from '@/helpers/notesUtils'
import { ChatSession } from './ChatSession'
import { RunStorage, type RunFile } from './RunStorage'

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

  /** Call after plugin load to restore tabs from previous session */
  async restoreTabs(): Promise<void> {
    this.tabsRestored = true
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      if (this.sessions.size === 0) this.createTab()
      return
    }

    // Clear any tabs created before restore
    for (const session of this.sessions.values()) session.destroy()
    this.sessions.clear()
    this.tabOrder.value = []
    this.activeTabId.value = null

    try {
      const state: TabsState = JSON.parse(raw)
      if (!state.tabs?.length) {
        this.createTab()
        return
      }

      const { app } = GlobalStore.getInstance()
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }

  // ── Session / tab management ──────────────────────────────────

  createTab(): string {
    if (this.sessions.size >= MAX_TABS) {
      // Return active tab if at limit
      return this.activeTabId.value!
    }
    const session = new ChatSession(this)
    this.sessions.set(session.id, session)
    this.tabOrder.value = [...this.tabOrder.value, session.id]
    this.activeTabId.value = session.id
    if (this.tabsRestored) this.saveTabs()
    return session.id
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
    this.sessions.delete(tabId)
    this.tabOrder.value = this.tabOrder.value.filter((id) => id !== tabId)

    if (this.sessions.size === 0) {
      // Always keep at least one tab
      this.createTab()
      return
    }

    // If we closed the active tab, switch to adjacent
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

  getAuxiliaryModelConfig(): ModelConfig {
    const config = AbeleConfig.getInstance().ai
    if (!config.auxiliaryModelId) return this.getActiveModelConfig()

    for (const provider of config.providers) {
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

    return this.getActiveModelConfig()
  }

  // ── System prompt ─────────────────────────────────────────────

  async getSystemPrompt(session: ChatSession): Promise<string> {
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
      session.destroy()
    }
    this.sessions.clear()
    this.runTabs.clear()
    this.tabOrder.value = []
    this.activeTabId.value = null
    ChatService.instance = null
  }
}
