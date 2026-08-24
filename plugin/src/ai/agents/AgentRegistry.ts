import { reactive, ref, isReactive } from 'vue'
import { TFile } from 'obsidian'
import dayjs from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { getNoteBody } from '@/helpers/notesUtils'
import { createAgent, type AgentDefinition, type AgentPrompt } from './types'
import { CORE_TOOLS } from '@/ai/types'
import type { ModelConfig } from '@/ai/client'
import type { AiModelConfig, AiProvider } from '@/ai/types'
import type { SkillInfo } from '@/ai/tools/SkillTool'

/**
 * The one place that answers what an agent is.
 *
 * Model, prompt, tool and skill resolution used to live in four independent copies —
 * `ChatService`, `ChatSession`, `WiseModelTool` and `ScriptContext`. They collapse here so a
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

  /**
   * Bumped when the *set* of agents changes, or when settings are replaced wholesale.
   *
   * Field-level edits do not need it — those go through the reactive proxy below. This covers
   * what a proxy cannot see: an agent appearing, disappearing, or the whole array being
   * swapped out by a settings reload.
   */
  private readonly version = ref(0)

  /**
   * The agents, as a Vue-tracked array.
   *
   * `AbeleConfig` is a plain class, so an agent read out of it raw is invisible to `computed`.
   * Wrapping once here means every consumer — settings editor, chat session, delegation —
   * shares one proxy, and reading an agent field inside a computed registers a dependency.
   * That is the entire mechanism behind editing an agent reaching a chat already in progress.
   */
  private get agents(): AgentDefinition[] {
    void this.version.value

    const ai = AbeleConfig.getInstance().ai
    if (!ai.agents) ai.agents = []
    if (!isReactive(ai.agents)) ai.agents = reactive(ai.agents)
    return ai.agents
  }

  /** Call after settings are loaded or replaced, so tracked reads see the new array. */
  notifyConfigReloaded(): void {
    this.version.value++
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
    void this.version.value
    const configured = this.get(AbeleConfig.getInstance().ai.defaultAgentId)
    return configured ?? this.agents[0] ?? null
  }

  // ── Mutation ──────────────────────────────────────────────────

  create(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
    const agents = this.agents
    agents.push(createAgent(overrides))
    this.version.value++
    // Returns the proxy rather than the raw object, so a caller that holds on to it and edits
    // it later still reaches everyone reading through the registry.
    return agents[agents.length - 1]
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
    this.version.value++

    const ai = AbeleConfig.getInstance().ai
    if (ai.defaultAgentId === id) ai.defaultAgentId = this.agents[0].id
    return true
  }

  setDefault(id: string): void {
    if (!this.get(id)) return
    AbeleConfig.getInstance().ai.defaultAgentId = id
    // `defaultAgentId` lives on the plain config object, so nothing would notice on its own.
    this.version.value++
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

  // ── System prompt ─────────────────────────────────────────────

  /**
   * Concatenates an agent's prompt blocks in order, blank line between them.
   *
   * A block that resolves to nothing — a note that was moved, an empty textarea — is dropped
   * rather than contributing an empty line, so reordering blocks in the editor never changes
   * the spacing the model sees.
   */
  async buildSystemPrompt(agent: AgentDefinition): Promise<string> {
    const date = dayjs().format('YYYY-MM-DD')
    const blocks: string[] = []

    for (const prompt of agent.prompts || []) {
      const text = await this.readPromptBlock(prompt)
      if (text) blocks.push(text.replace(/\{\{date\}\}/g, date))
    }

    return blocks.join('\n\n')
  }

  private async readPromptBlock(prompt: AgentPrompt): Promise<string> {
    if (prompt.type === 'text') return prompt.value.trim()

    if (!prompt.value) return ''
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath(prompt.value)
    if (!(file instanceof TFile)) {
      console.warn(`[Abele] Agent prompt note not found, skipping: ${prompt.value}`)
      return ''
    }

    const content = await app.vault.cachedRead(file)
    return getNoteBody(content).trim()
  }

  // ── Tool and skill filters ────────────────────────────────────

  /**
   * Narrows a tool list to what an agent may use.
   *
   * Takes the list rather than building it, so the decision is a pure function of the agent
   * and is testable without standing up every tool's dependencies.
   *
   * Core tools are never filtered here — they stay available to every agent and are governed
   * by `permissionMode` and workspace scope at call time instead.
   */
  filterTools<T extends { name: string }>(agent: AgentDefinition, tools: T[]): T[] {
    return tools.filter((tool) => {
      if (tool.name === 'delegate' && agent.maxDelegateDepth <= 0) return false
      if (CORE_TOOLS.has(tool.name)) return true
      return (agent.toolModes[tool.name] ?? 'off') !== 'off'
    })
  }

  /** Which skills the `skill` tool advertises to this agent. */
  visibleSkills(agent: AgentDefinition, skills: SkillInfo[]): SkillInfo[] {
    if (agent.skillsMode === 'none') return []
    if (agent.skillsMode === 'all') return skills

    const selected = new Set(agent.skills)
    return skills.filter((skill) => selected.has(skill.name))
  }
}
