import { t } from '@/i18n'
import { nanoid } from 'nanoid'
import type { NodeScopeEntry, NodeScopeTarget } from '../nodeScope'
import type { SectionOpening } from '../toolSections'
import {
  NODE_ACTION_DEFAULTS,
  BOOK_TOOL_MODES,
  DOCX_TOOL_MODES,
  XLSX_TOOL_MODES,
  CANVAS_TOOL_MODES,
  TRACE_TOOL_MODES,
  GITHUB_TOOL_MODES,
  LINT_TOOL_MODES,
  LOCATION_TOOL_MODES,
  ANALYTICS_TOOL_MODES,
  type PermissionMode,
  type ToolMode,
} from '@/ai/types'

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
  /** Agent or script review runs alongside the main turn without holding the message. */
  interceptorReplyOnly: boolean
  /** What the interceptor checks: the person's messages, the agent's finished answers, or both. */
  interceptorChecks: InterceptorChecks
  /**
   * A script that decides about each message instead of a reviewing agent, by its `@name`; see
   * `src/ai/interceptor/`. Empty means none. Set, it wins over `interceptorAgentId`.
   */
  interceptorScript: string
  /** Only messages matching this regular expression go to the interceptor; empty means all. */
  interceptorPattern: string
  /**
   * The interceptors in the order they run, each given what the one before returned. Unset on
   * agents saved before lists: the single interceptor the fields above describe is the list. Set,
   * it wins, and the fields above only mirror its first switched-on entry for older builds; see
   * `src/ai/interceptor/entries.ts`.
   */
  interceptors?: InterceptorEntry[]

  /** Concatenated in order, blank line between blocks. */
  prompts: AgentPrompt[]

  permissionMode: PermissionMode
  /** Feature tools only — CORE_TOOLS are always available and governed by permissionMode. */
  toolModes: Record<string, ToolMode>
  /**
   * How tools reach the agent: by section (the default) or all at once. `all`, `by-group` and
   * absent are older saves and mean sections too; see `toolDiscoveryMode`.
   */
  toolDiscovery?: ToolDiscoverySetting
  /**
   * By section: which sections stand open from the first request, by section id (`toolSections.ts`).
   * Absent means the section's default: Files and Basics always, every other on request.
   */
  toolSectionOpening?: Record<string, SectionOpening>
  /** The owner's own words for what a section is for, by section id, in place of its default. */
  toolSectionDescriptions?: Record<string, string>
  /** Per-connection GitHub access. Absent IDs are Off, including newly added connections. */
  githubConnections?: Record<string, ToolMode>
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

export type ToolDiscoverySetting = 'sections' | 'all-at-once' | 'all' | 'by-group'

/**
 * Sections, unless the agent was set to all at once. Every agent saved before sections had
 * `all` written by default, so that value cannot tell a choice from a default and means sections.
 */
export function toolDiscoveryMode(
  agent: { toolDiscovery?: ToolDiscoverySetting } | null | undefined
): 'sections' | 'all-at-once' {
  return agent?.toolDiscovery === 'all-at-once' ? 'all-at-once' : 'sections'
}

/** The context depths an interceptor accepts; anything else read from a file is taken as the draft. */
export function normaliseContextDepth(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -1 ? value : 0
}

/** The context depths an interceptor can be given, as both pickers offer them. */
/** The person's message before it is sent, the agent's answer once its turn ends, or both. */
export type InterceptorChecks = 'message' | 'answer' | 'both'

/** A stored choice of what is checked; anything unknown means messages, as before answers. */
export function normaliseChecks(value: unknown): InterceptorChecks {
  return value === 'answer' || value === 'both' ? value : 'message'
}

/**
 * One interceptor in an agent's or a chat's list: who reads (a script by its `@name`, which wins,
 * or a reviewing agent), what it reads and how. Switched off, it keeps its place and is skipped.
 */
export interface InterceptorEntry {
  id: string
  /** The reviewing agent; empty with a script. */
  agentId: string
  /** The interceptor script by its `@name`; set, it wins over `agentId`. */
  script: string
  checks: InterceptorChecks
  /** Only text matching this regular expression is read; empty means all. */
  pattern: string
  /** Comments beside the person's message without holding or changing it. */
  replyOnly: boolean
  /** 0 the text alone, -1 the whole visible history, N the last N messages. */
  contextDepth: number
  enabled: boolean
}

export const INTERCEPTOR_CHECKS_OPTIONS: { value: InterceptorChecks; display: string }[] = [
  {
    value: 'message',
    get display() {
      return t('streamB.yourMessages.befc6e')
    },
  },
  {
    value: 'answer',
    get display() {
      return t('streamB.theAgentSAnswers.f39b19')
    },
  },
  {
    value: 'both',
    get display() {
      return t('streamB.both.b6c1d8')
    },
  },
]

export const INTERCEPTOR_CONTEXT_OPTIONS = [
  {
    value: '0',
    get display() {
      return t('streamB.draftOnly.0ca9f9')
    },
  },
  {
    value: '4',
    get display() {
      return t('streamB.last4Messages.65c3ce')
    },
  },
  {
    value: '10',
    get display() {
      return t('streamB.last10Messages.87e460')
    },
  },
  {
    value: '-1',
    get display() {
      return t('streamB.wholeConversation.27ba02')
    },
  },
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
    toolDiscovery: 'sections',
    // Memory asks by default. A deliberate auto/off choice overrides this, including on
    // existing agents where the saved file cannot distinguish old defaults from choices.
    // The GitHub tools only read, and only exist while the integration is on. The book tools read
    // on their own and ask before they mark a book.
    toolModes: {
      remember: 'ask',
      forget: 'ask',
      ...GITHUB_TOOL_MODES,
      ...BOOK_TOOL_MODES,
      ...DOCX_TOOL_MODES,
      ...XLSX_TOOL_MODES,
      ...CANVAS_TOOL_MODES,
      ...TRACE_TOOL_MODES,
      ...NODE_ACTION_DEFAULTS,
      ...LINT_TOOL_MODES,
      ...LOCATION_TOOL_MODES,
      ...ANALYTICS_TOOL_MODES,
    },
    // An explicit empty map distinguishes a new agent from saved pre-connection agents.
    githubConnections: {},
    scope: [],
    fullVaultAccess: false,
    skillsMode: 'all',
    skills: [],
    maxDelegateDepth: 2,
    memory: [],
    interceptorAgentId: '',
    interceptorContextDepth: 0,
    interceptorReplyOnly: false,
    interceptorChecks: 'message',
    interceptorScript: '',
    interceptorPattern: '',
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
  /** Remote permissions travel with the chat; local owner approval never does. */
  nodeScope?: NodeScopeEntry[]
  /** Selection is not permission and cannot expand nodeScope. */
  nodeTarget?: NodeScopeTarget
  fullVaultAccess?: boolean
  prompts?: AgentPrompt[]
}

export type OverrideKey = keyof SessionOverrides
