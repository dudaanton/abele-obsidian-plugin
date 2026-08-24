import { nanoid } from 'nanoid'
import type { PermissionMode, ToolMode } from '@/ai/types'

/** One block of an agent's system prompt: inline text, or the body of a vault note. */
export interface AgentPrompt {
  type: 'text' | 'note'
  /** The text itself when `type` is 'text', a vault path when it is 'note'. */
  value: string
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
}

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
    toolModes: {},
    scope: [],
    fullVaultAccess: false,
    skillsMode: 'all',
    skills: [],
    maxDelegateDepth: 2,
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
