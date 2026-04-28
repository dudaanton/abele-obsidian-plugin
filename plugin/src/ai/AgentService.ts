import { ref, computed } from 'vue'
import { TFile } from 'obsidian'
import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ModelConfig } from './client'
import { DEFAULT_AI_SETTINGS } from './types'
import { getNoteBody } from '@/helpers/notesUtils'
import { ChatSession } from './ChatSession'

const MAX_TABS = 8
const STORAGE_KEY = 'abele-agent-tabs'

interface TabsState {
  tabs: Array<{ chatFilePath: string | null }>
  activeIndex: number
}

export class AgentService {
  private static instance: AgentService | null = null

  private sessions = new Map<string, ChatSession>()
  private tabsRestored = false
  public readonly activeTabId = ref<string | null>(null)
  public readonly tabOrder = ref<string[]>([])

  public readonly activeSession = computed<ChatSession | null>(() =>
    this.activeTabId.value ? (this.sessions.get(this.activeTabId.value) ?? null) : null
  )

  static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService()
    }
    return AgentService.instance
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
      tabs: this.tabOrder.value.map((id) => {
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
    if (this.sessions.has(tabId)) {
      this.activeTabId.value = tabId
      this.saveTabs()
    }
  }

  getSession(tabId: string): ChatSession | null {
    return this.sessions.get(tabId) ?? null
  }

  getSessionByFile(filePath: string): ChatSession | null {
    for (const session of this.sessions.values()) {
      if (session.currentChatFile.value?.path === filePath) {
        return session
      }
    }
    return null
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

  getDelegateModelConfig(): ModelConfig {
    const config = AbeleConfig.getInstance().ai
    if (config.delegateModelId) {
      for (const provider of config.providers) {
        const model = provider.models.find((m) => m.id === config.delegateModelId)
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

    // Global: note path
    const config = AbeleConfig.getInstance().ai
    if (config.systemPromptFromNote && config.systemPromptNotePath) {
      const body = await this.readNoteBody(config.systemPromptNotePath)
      if (body) return body.replace(/\{\{date\}\}/g, date)
    }

    // Global: inline text
    const base = config.prompts?.system || DEFAULT_AI_SETTINGS.prompts.system
    return base.replace(/\{\{date\}\}/g, date)
  }

  async getDelegateSystemPrompt(session: ChatSession): Promise<string> {
    return this.getSystemPrompt(session)
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
    this.tabOrder.value = []
    this.activeTabId.value = null
    AgentService.instance = null
  }
}
