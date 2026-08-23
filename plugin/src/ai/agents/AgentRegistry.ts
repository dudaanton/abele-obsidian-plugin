import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { createAgent, type AgentDefinition } from './types'
import type { ModelConfig } from '@/ai/client'
import type { AiModelConfig, AiProvider } from '@/ai/types'

/**
 * The one place that answers what an agent is.
 *
 * Model, prompt, tool and skill resolution used to live in four independent copies —
 * `AgentService`, `ChatSession`, `WiseModelTool` and `ScriptContext`. They collapse here so a
 * chat, a delegated run and a script all resolve an agent identically.
 *
 * Every accessor reads `AbeleConfig` on each call and mutations edit the stored objects in
 * place. That is deliberate: a chat session holds an agent id, not a copy of its settings, so
 * editing an agent reaches every running chat with no notification mechanism at all.
 */
export class AgentRegistry {
  private static instance: AgentRegistry | null = null

  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) AgentRegistry.instance = new AgentRegistry()
    return AgentRegistry.instance
  }

  static destroy(): void {
    AgentRegistry.instance = null
  }

  private get agents(): AgentDefinition[] {
    const ai = AbeleConfig.getInstance().ai
    if (!ai.agents) ai.agents = []
    return ai.agents
  }

  // ── Lookup ────────────────────────────────────────────────────

  get(id: string): AgentDefinition | null {
    if (!id) return null
    return this.agents.find((a) => a.id === id) ?? null
  }

  getByName(name: string): AgentDefinition | null {
    if (!name) return null
    const needle = name.trim().toLowerCase()
    return this.agents.find((a) => a.name.trim().toLowerCase() === needle) ?? null
  }

  /** Accepts whichever of the two a caller happens to have — scripts and tools pass names. */
  resolve(idOrName: string): AgentDefinition | null {
    return this.get(idOrName) ?? this.getByName(idOrName)
  }

  list(options: { includeUtility?: boolean } = {}): AgentDefinition[] {
    return options.includeUtility ? [...this.agents] : this.agents.filter((a) => !a.utility)
  }

  defaultAgent(): AgentDefinition | null {
    const configured = this.get(AbeleConfig.getInstance().ai.defaultAgentId)
    return configured ?? this.agents[0] ?? null
  }

  // ── Mutation ──────────────────────────────────────────────────

  create(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
    const agent = createAgent(overrides)
    this.agents.push(agent)
    return agent
  }

  update(id: string, patch: Partial<AgentDefinition>): void {
    const agent = this.get(id)
    if (!agent) return
    Object.assign(agent, patch)
  }

  duplicate(id: string): AgentDefinition | null {
    const source = this.get(id)
    if (!source) return null

    // Collections are rebuilt rather than shared, so editing the copy never reaches the source.
    return this.create({
      ...source,
      id: undefined,
      name: `${source.name} (copy)`,
      prompts: source.prompts.map((p) => ({ ...p })),
      toolModes: { ...source.toolModes },
      scope: source.scope.map((s) => ({ ...s })),
      skills: [...source.skills],
    })
  }

  /** Returns false when the removal was refused — the last agent always stays. */
  remove(id: string): boolean {
    if (this.agents.length <= 1) return false

    const index = this.agents.findIndex((a) => a.id === id)
    if (index === -1) return false

    this.agents.splice(index, 1)

    const ai = AbeleConfig.getInstance().ai
    if (ai.defaultAgentId === id) ai.defaultAgentId = this.agents[0].id
    return true
  }

  setDefault(id: string): void {
    if (!this.get(id)) return
    AbeleConfig.getInstance().ai.defaultAgentId = id
  }

  // ── Model resolution ──────────────────────────────────────────

  /**
   * Resolves an agent's model into a client config, or null when it cannot be resolved.
   *
   * Null is a real answer, not a failure to be papered over: silently substituting some other
   * model is how a chat ends up quietly running on the wrong one. Callers decide what to show.
   */
  resolveModel(agent: AgentDefinition, options: { fallback?: boolean } = {}): ModelConfig | null {
    const providerId = options.fallback ? agent.fallbackProviderId : agent.providerId
    const modelId = options.fallback ? agent.fallbackModelId : agent.modelId
    if (!modelId) return null

    const found = this.findModel(providerId ?? '', modelId)
    if (!found) return null

    return {
      id: found.model.id,
      name: found.model.name,
      baseUrl: found.provider.baseUrl,
      apiKey: GlobalStore.getInstance().app.secretStorage.getSecret(found.provider.apiKeyId) || '',
      contextWindow: found.model.contextWindow,
      maxTokens: found.model.maxTokens,
      supportsReasoning: found.model.supportsReasoning,
      ...(found.model.reasoningEffort ? { reasoningEffort: found.model.reasoningEffort } : {}),
    }
  }

  /**
   * An empty `providerId` means "search every provider" — migrated interceptors and older
   * chats stored a bare model id, and that is how they were resolved before.
   */
  private findModel(
    providerId: string,
    modelId: string
  ): { provider: AiProvider; model: AiModelConfig } | null {
    const providers = AbeleConfig.getInstance().ai.providers || []
    const candidates = providerId ? providers.filter((p) => p.id === providerId) : providers

    for (const provider of candidates) {
      const model = provider.models.find((m) => m.id === modelId)
      if (model) return { provider, model }
    }
    return null
  }
}
