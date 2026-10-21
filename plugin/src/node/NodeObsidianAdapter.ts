import { TFile } from 'obsidian'
import { obsidianDeviceName } from './obsidianDevice'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { resolveTargetAgent } from '@/ai/DelegateRun'
import { ObsidianDelegateArgumentsSchema } from '@abele/node-protocol'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { ordinaryNeedsApproval, ORDINARY_SCOPED_TOOLS } from '@/ai/ordinaryToolPolicy'
import { createAgentTools } from '@/ai/tools'
import { skillNeedsApproval } from '@/ai/tools/SkillTool'
import { CORE_TOOLS } from '@/ai/types'
import { contentHash, ReadGuard } from '@/ai/readGuard'
import type { AgentTool, AgentToolResult, Message, ReadMark } from '@/ai/client'
import { ResultStore, createReadResultTool } from '@/ai/resultStore'
import { GlobalStore } from '@/stores/GlobalStore'
import { toolPermissionKey } from '@/ai/mcp/permissions'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  ObsidianNotExecuted,
  type ObsidianInvocation,
  type ObsidianToolAdapter,
} from './NodeObsidianExecutor'

export interface ObsidianToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  mode: 'off' | 'ask' | 'auto'
}

/** Preserve ordinary names where the node accepts them; bind other aliases to exact handlers. */
export const wireName = (name: string): string =>
  /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : `abeleTool_${contentHash(name)}`

/** Ordinary registry, handlers and guards bound to one node agent, never the active vault chat. */
export class NodeObsidianAdapter implements ObsidianToolAdapter {
  private readonly scope = new ScopeResolver()
  private readonly guardScope = new ScopeResolver()
  private readonly guard = new ReadGuard({ history: () => [], scope: () => this.guardScope })
  private history: Message[] = []
  private readonly results = new ResultStore({ messages: () => this.history })
  constructor(
    readonly agentId: string,
    readonly revision: string,
    private readonly marks: (session: string, run: string) => Promise<ReadMark[]>,
    private readonly previousResults: (
      session: string
    ) => Promise<AgentToolResult[]> = async () => []
  ) {
    this.guardScope.setFullVaultAccess(true)
  }

  private agent() {
    const agent = AgentRegistry.getInstance().get(this.agentId)
    if (!agent) throw new ObsidianNotExecuted('This agent is no longer configured')
    this.scope.entries.value = agent.scope.map((entry) => ({ ...entry }))
    this.scope.setFullVaultAccess(agent.fullVaultAccess)
    this.scope.invalidate()
    return agent
  }
  private registry(): AgentTool[] {
    return [
      ...createAgentTools({
        agentId: this.agentId,
        scope: this.scope,
        githubAgent: () => this.agent(),
      }),
      createReadResultTool(this.results),
    ]
  }
  private asks(name: string, args?: Record<string, unknown>, permissionKey?: string): boolean {
    const agent = this.agent()
    return ordinaryNeedsApproval(
      {
        permissionMode:
          agent.node && agent.toolModes[permissionKey ?? name] === 'auto'
            ? 'allow-all'
            : agent.permissionMode,
        toolModes: agent.toolModes,
        getToolMode: (tool) =>
          agent.toolModes[toolPermissionKey(tool, AbeleConfig.getInstance().ai.mcpServers)] ??
          'off',
        outOfScopePath: (tool, params) => {
          if (!ORDINARY_SCOPED_TOOLS.includes(tool)) return null
          const path = params?.path ?? params?.from
          return typeof path === 'string' && !this.scope.isInScope(path) ? path : null
        },
        bookAnchored: false,
        skillNeedsApproval: (skill) => skillNeedsApproval(skill, agent, this.scope),
      },
      name,
      args,
      permissionKey
    )
  }
  tools(): ObsidianToolDefinition[] {
    const agent = this.agent()
    const all = this.registry()
    const allowed = new Set(
      AgentRegistry.getInstance()
        .filterTools(agent, all)
        .map((tool) => tool.name)
    )
    return all.map((tool) => ({
      name: wireName(tool.name),
      description: tool.description,
      inputSchema: tool.parameters,
      mode: !allowed.has(tool.name)
        ? 'off'
        : agent.node && agent.toolModes[tool.permissionKey ?? tool.name] !== undefined
          ? agent.toolModes[tool.permissionKey ?? tool.name]
          : this.asks(tool.name, undefined, tool.permissionKey)
            ? 'ask'
            : 'auto',
    }))
  }
  permissionModes(ceiling: ReadonlyMap<string, 'off' | 'ask' | 'auto'>) {
    const current = new Map(this.tools().map((tool) => [tool.name, tool.mode]))
    const rank = { off: 0, ask: 1, auto: 2 }
    return Object.fromEntries(
      this.registry().map((tool) => {
        const name = wireName(tool.name),
          a = current.get(name) ?? 'off',
          b = ceiling.get(name) ?? 'off'
        return [tool.permissionKey ?? tool.name, rank[a] <= rank[b] ? a : b]
      })
    )
  }
  private tool(i: ObsidianInvocation): AgentTool {
    const agent = this.agent()
    const matches = AgentRegistry.getInstance()
      .filterTools(agent, this.registry())
      .filter((tool) => wireName(tool.name) === i.tool_name)
    if (matches.length > 1) throw new ObsidianNotExecuted('This tool alias is ambiguous')
    const tool = matches[0]
    if (
      !tool ||
      (agent.node && agent.toolModes[tool.permissionKey ?? tool.name] === 'off') ||
      (!CORE_TOOLS.has(tool.name) &&
        (agent.toolModes[tool.permissionKey ?? tool.name] ?? 'off') === 'off')
    )
      throw new ObsidianNotExecuted('This tool is disabled for the agent')
    return tool
  }
  async prepare(i: ObsidianInvocation) {
    const tool = this.tool(i)
    if (tool.name === 'delegate') {
      const args = ObsidianDelegateArgumentsSchema.safeParse(i.arguments)
      if (!args.success) throw new ObsidianNotExecuted('Invalid delegation arguments')
      const target = resolveTargetAgent(args.data.agent)
      if (!target || target.node)
        throw new ObsidianNotExecuted(`Agent "${args.data.agent}" not found`)
      if ((this.agent().maxDelegateDepth ?? 0) <= 0)
        throw new ObsidianNotExecuted('This agent cannot delegate at its current depth limit')
    }
    this.history = (await this.previousResults(i.session_id)).map((result, index) => ({
      role: 'toolResult',
      toolCallId: String(index),
      toolName: 'stored',
      content: result.content,
      stored: result.stored,
      isError: false,
      timestamp: 0,
    }))
    const args = i.arguments
    const path =
      typeof args.path === 'string'
        ? args.path
        : typeof args.from === 'string'
          ? args.from
          : undefined
    const preview: Record<string, unknown> = {
      tool_name: tool.name,
      device: obsidianDeviceName(),
    }
    if (path) {
      preview.path = path
      const app = GlobalStore.getInstance().app
      const file = app.vault.getAbstractFileByPath(path)
      const old = file instanceof TFile ? await app.vault.read(file) : null
      // Source evidence is part of the exact approval, even for calls without a text diff.
      preview.sourceHash = old === null ? null : contentHash(old)
      if (tool.name === 'create') {
        preview.content = args.content
      } else if (tool.name === 'write') {
        preview.diff = { old: old ?? '', new: args.content }
      } else if (
        tool.name === 'edit' &&
        old !== null &&
        typeof args.old_string === 'string' &&
        typeof args.new_string === 'string'
      ) {
        preview.diff = { old, new: old.replace(args.old_string, () => args.new_string as string) }
      }
    }
    if (JSON.stringify(preview).length > 65536)
      throw new ObsidianNotExecuted(
        'The tool preview exceeds the node size limit. Read or edit a smaller passage.'
      )
    return { preview, needsApproval: this.asks(tool.name, args, tool.permissionKey) }
  }
  async execute(
    i: ObsidianInvocation,
    bypass: boolean,
    signal: AbortSignal
  ): Promise<Record<string, unknown>> {
    const tool = this.tool(i)
    const prepared = await this.prepare(i)
    if (i.preview && JSON.stringify(prepared.preview) !== JSON.stringify(i.preview))
      throw new ObsidianNotExecuted(
        'The target changed after approval. Request the action again from the current source.'
      )
    // A ready envelope and the first claim authorize exactly this prepared call. Bypass is
    // supplied by the node, never an argument controlled by the provider.
    if (!bypass && prepared.needsApproval && !i.preview)
      throw new ObsidianNotExecuted('This action needs an exact approval before execution')
    this.guard.settle()
    this.guard.note(await this.marks(i.session_id, i.run_id))
    const refused = await this.guard.check(tool.name, i.arguments)
    if (refused) throw new ObsidianNotExecuted(refused)
    const scope = this.scope.snapshot()
    // The per-action approval widens only this invocation's ordinary handler context.
    const path = i.arguments.path ?? i.arguments.from
    if (typeof path === 'string' && (bypass || i.preview)) scope.addFile(path)
    try {
      signal.throwIfAborted()
      const result = await tool.execute(i.invocation_id, i.arguments, signal, {
        scope,
        agentId: this.agentId,
        interactive: true,
        approved: true,
        validateWrite: () => {
          signal.throwIfAborted()
          this.tool(i)
        },
      })
      await this.guard.record(tool.name, i.arguments, result)
      this.results.keep(tool.name, i.invocation_id, result)
      return { ...result }
    } finally {
      scope.destroy()
    }
  }
  destroy(): void {
    this.scope.destroy()
    this.guardScope.destroy()
  }
}
