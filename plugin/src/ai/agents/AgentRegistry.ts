import { AbeleConfig } from '@/services/AbeleConfig'
import { createAgent, type AgentDefinition } from './types'

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
}
