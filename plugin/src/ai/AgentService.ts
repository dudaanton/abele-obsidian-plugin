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

export class AgentService {
  private static instance: AgentService | null = null

  private sessions = new Map<string, ChatSession>()
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
    // Create the initial default tab
    this.createTab()
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
  }

  switchTab(tabId: string): void {
    if (this.sessions.has(tabId)) {
      this.activeTabId.value = tabId
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

  // ── Global model switching ─────────────────────────────────────

  switchModel(providerId: string, modelId: string): void {
    const config = AbeleConfig.getInstance()
    config.ai.activeProviderId = providerId
    config.ai.activeModelId = modelId
    config.saveSettings()
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
