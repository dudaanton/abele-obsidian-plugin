import { nanoid } from 'nanoid'
import { GITHUB_TOOL_MODES, type PermissionMode, type ToolMode } from '@/ai/types'

/** One block of an agent's system prompt: inline text, or the body of a vault note. */
export interface AgentPrompt {
  type: 'text' | 'note'
  /** The text itself when `type` is 'text', a vault path when it is 'note'. */
  value: string
}

/** One thing the person asked this agent to remember. Short by rule — see `agents/memory.ts`. */
export interface AgentMemoryItem {
  id: string
  text: string
  /** YYYY-MM-DD, shown in the agent's settings beside the item. */
  created: string
}

export interface ScopeEntry {
  type: 'file' | 'folder' | 'pattern' | 'group'
  path: string
}

export interface AgentDefinition {
  id: string
  name: string
  description: string
  /** Hidden from the chat agent picker. Still reachable from scripts, delegation, interceptors. */
  utility: boolean

  providerId: string
  modelId: string
  fallbackProviderId?: string
  fallbackModelId?: string
  /**
   * For the plugin's own background work on this agent's chats — naming them, compacting them.
   * Empty means the plugin-wide Background Model setting decides, and if that is unset too, the
   * chat's own model does.
   */
  auxiliaryProviderId?: string
  auxiliaryModelId?: string

  /**
   * The agent that reviews a draft before it reaches this one, in every chat that runs on it.
   * Empty means none. A chat can override it either way; delegated runs and scripts never use
   * it — nobody is there to read the review. Never this agent itself.
   */
  interceptorAgentId: string
  /** How much of the conversation the interceptor sees: 0 the draft, -1 all of it, N the last N. */
  interceptorContextDepth: number

  /** Concatenated in order, blank line between blocks. */
  prompts: AgentPrompt[]

  permissionMode: PermissionMode
  /** Feature tools only — CORE_TOOLS are always available and governed by permissionMode. */
  toolModes: Record<string, ToolMode>
  scope: ScopeEntry[]
  fullVaultAccess: boolean

  skillsMode: 'all' | 'none' | 'selected'
  /** Skill names, meaningful only when skillsMode is 'selected'. */
  skills: string[]

  /** How deep this agent may delegate. 0 forbids delegation entirely. */
  maxDelegateDepth: number

  /**
   * What this agent was asked to remember. Its own: only this agent's prompt shows it and only
   * its `remember` and `forget` calls change it. Optional because agents saved before memory lack it.
   */
  memory?: AgentMemoryItem[]
}

/** The context depths an interceptor accepts; anything else read from a file is taken as the draft. */
export function normaliseContextDepth(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -1 ? value : 0
}

/** The context depths an interceptor can be given, as both pickers offer them. */
export const INTERCEPTOR_CONTEXT_OPTIONS = [
  { value: '0', display: 'Draft only' },
  { value: '4', display: 'Last 4 messages' },
  { value: '10', display: 'Last 10 messages' },
  { value: '-1', display: 'Whole conversation' },
]

/**
 * Builds a complete agent. Every field gets a value so that consumers never have to guard
 * for `undefined` on an agent loaded from an older settings file — migration and the editor
 * both go through here.
 */
export function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  const base: AgentDefinition = {
    id: nanoid(),
    name: 'New agent',
    description: '',
    utility: false,
    providerId: '',
    modelId: '',
    prompts: [],
    permissionMode: 'confirm-all',
    // Memory is on for every agent unless someone turns it off — `enableMemoryTool` in the
    // migration does the same for agents saved before it existed.
    // The GitHub tools only read, and only exist while the integration is on.
    toolModes: { remember: 'auto', forget: 'auto', ...GITHUB_TOOL_MODES },
    scope: [],
    fullVaultAccess: false,
    skillsMode: 'all',
    skills: [],
    maxDelegateDepth: 2,
    memory: [],
    interceptorAgentId: '',
    interceptorContextDepth: 0,
  }

  // Duplication spreads a source agent in and clears `id` to ask for a fresh one. Spreading an
  // explicit `undefined` would wipe the generated value, so drop the key before merging.
  const patch = { ...overrides }
  if (patch.id === undefined) delete patch.id

  return { ...base, ...patch }
}

/**
 * What a chat has deliberately changed relative to its agent.
 *
 * Sparse by design: a key present here means somebody changed it in this chat and it must stop
 * tracking the agent; a key absent means the chat follows whatever the agent says today.
 */
export interface SessionOverrides {
  providerId?: string
  modelId?: string
  permissionMode?: PermissionMode
  toolModes?: Record<string, ToolMode>
  scope?: ScopeEntry[]
  fullVaultAccess?: boolean
  prompts?: AgentPrompt[]
}

export type OverrideKey = keyof SessionOverrides
