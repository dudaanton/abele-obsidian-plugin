import { z } from 'zod'
import { t } from '@/i18n'

const Capability = z.union([
  z.object({ status: z.literal('supported'), evidence: z.string() }),
  z.object({ status: z.enum(['unsupported', 'unverified']), reason: z.string() }),
])
/** An agent a provider hosts (ACP: Gemini, OpenCode…), by the name sessions are made with. */
const HostedAgent = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
  name: z.string().max(128),
  available: z.boolean(),
  diagnostic: z.string().nullable().optional(),
})
const Provider = z.object({
  provider: z.enum(['claude', 'pi', 'fake', 'codex', 'acp']),
  available: z.boolean().optional(),
  diagnostic: z.string().nullable().optional(),
  /** Providers that host several agents list them; each is chosen on its own. */
  agents: z.array(HostedAgent).optional(),
  permission_modes: z.array(z.string()).optional(),
  configuration: z
    .object({
      model: z.string().optional(),
      models: z.array(z.string()).optional(),
      profile: z.string().optional(),
      /** Long-lived sessions: what a session can be set to on this node. */
      live_sessions: z.boolean().optional(),
      accounts: z.array(z.string()).optional(),
      efforts: z.array(z.string()).optional(),
      permission_modes: z.array(z.string()).optional(),
    })
    .optional(),
  capabilities: z.record(z.string(), Capability).default({}),
})
const DebuggerDescription = z.object({
  capabilities: z.object({
    provider: z.literal('node').optional(),
    capabilities: z.object({ debugger_v1: Capability.optional() }),
  }),
})
/** Debugger support is a node/channel capability, not an individual model provider's feature. */
export function nodeDebuggerSupported(description: unknown): boolean {
  const result = DebuggerDescription.safeParse(description)
  return result.success && result.data.capabilities.capabilities.debugger_v1?.status === 'supported'
}
export type NodeProvider = z.infer<typeof Provider>
export type NodeProviderName = NodeProvider['provider']
export type HostedAgent = z.infer<typeof HostedAgent>
const LABEL: Record<string, string> = {
  pi: 'pi',
  claude: 'Claude Code',
  codex: 'Codex',
  acp: 'ACP agent',
  get fake() {
    return t('streamB.nodeTestAgent')
  },
  get ['']() {
    return t('streamB.agent.11b39c')
  },
}
export const providerLabel = (name: string): string => LABEL[name] ?? name
export const providerAvailable = (p: NodeProvider): boolean =>
  p.available === true || (p.provider === 'fake' && p.available !== false)
export function nodeProviders(description: unknown): NodeProvider[] {
  const raw =
    description && typeof description === 'object'
      ? (description as { providers?: unknown }).providers
      : undefined
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value) => {
    const result = Provider.safeParse(value)
    return result.success ? [result.data] : []
  })
}
/** Delegated work runs on the agents that take one message per run; ACP agents do not. */
export const delegatable = (p: NodeProvider): boolean =>
  ['claude', 'pi', 'codex', 'fake'].includes(p.provider)
export function capabilityReason(provider: NodeProvider | undefined, feature: string): string {
  const capability = provider?.capabilities[feature]
  return capability?.status === 'supported'
    ? ''
    : (capability?.reason ?? 'Not reported by this node')
}

/** One agent a new session can run: a provider, or one agent a provider hosts. */
export interface AgentChoice {
  provider: NodeProviderName
  /** The hosted agent's id, for a provider that hosts several. */
  agent?: string
  label: string
  /** Why it cannot be started on this node now; empty when it can. */
  unavailable: string
}

const DIAGNOSTIC: Record<string, string> = {
  acp_agent_not_installed: 'Not installed on the node',
  codex_executable_unavailable: 'Not installed on the node',
}
const said = (diagnostic: string | null | undefined): string =>
  (diagnostic && DIAGNOSTIC[diagnostic]) ||
  (diagnostic ? diagnostic.replace(/_/g, ' ') : 'Not available on this node')

/**
 * Every agent a new session could run, in the order people know them: Claude Code, Codex, pi,
 * then the ACP agents the node lists. An agent this node does not report or cannot start now
 * stays in the list, unavailable with the reason, so the list does not change shape between
 * nodes. The fake agent appears only on a node that offers it.
 */
export function agentChoices(providers: readonly NodeProvider[]): AgentChoice[] {
  const of = (name: NodeProviderName) => providers.find((p) => p.provider === name)
  const choices: AgentChoice[] = (['claude', 'codex', 'pi'] as const).map((name) => {
    const p = of(name)
    return {
      provider: name,
      label: providerLabel(name),
      unavailable: !p
        ? 'This node does not offer it yet'
        : providerAvailable(p)
          ? ''
          : said(p.diagnostic),
    }
  })
  for (const agent of of('acp')?.agents ?? [])
    choices.push({
      provider: 'acp',
      agent: agent.id,
      label: agent.name || agent.id,
      unavailable: agent.available ? '' : said(agent.diagnostic),
    })
  const fake = of('fake')
  if (fake && providerAvailable(fake))
    choices.push({ provider: 'fake', label: providerLabel('fake'), unavailable: '' })
  return choices
}
