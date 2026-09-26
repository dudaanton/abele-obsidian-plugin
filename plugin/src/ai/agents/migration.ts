import { createAgent, normaliseContextDepth, type AgentDefinition } from './types'
import { REMEMBER_TOOL, FORGET_TOOL } from './memory'
import {
  BOOK_TOOL_MODES,
  DEFAULT_AI_SETTINGS,
  EDIT_SELECTION_TOOL,
  GITHUB_TOOLS,
  MAP_TOOLS,
  type AiSettings,
} from '@/ai/types'

/**
 * Folds the pre-agent global configuration into agent entities.
 *
 * Runs once: the moment `ai.agents` is non-empty this is a no-op, so a user who has since
 * renamed or deleted the migrated agents never gets them resurrected. The legacy fields are
 * deliberately left in place — settings UI still edits them until phases 3 and 5 remove it.
 */
function migrateLegacyAgents(ai: AiSettings): boolean {
  if (ai.agents?.length) return false

  const agents: AgentDefinition[] = []

  const promptValue = ai.prompts?.system || DEFAULT_AI_SETTINGS.prompts.system
  const usesNote = Boolean(ai.systemPromptFromNote && ai.systemPromptNotePath)

  const base = createAgent({
    name: 'Default',
    description: 'Migrated from the global AI settings.',
    providerId: ai.activeProviderId || '',
    modelId: ai.activeModelId || '',
    prompts: usesNote
      ? [{ type: 'note', value: ai.systemPromptNotePath }]
      : [{ type: 'text', value: promptValue }],
    permissionMode: ai.permissionMode ?? 'confirm-all',
    toolModes: { ...(ai.toolModes || {}) },
    scope: [...(ai.defaultScope || [])],
    fullVaultAccess: ai.defaultFullVaultAccess ?? false,
  })
  agents.push(base)

  // Interceptors are agents in everything but name. `contextDepth` describes how one is used
  // rather than what it is, so it is dropped here and re-homed on the chat session instead.
  for (const interceptor of ai.interceptors || []) {
    agents.push(
      createAgent({
        // Reusing the interceptor's own id keeps every chat that already names it working:
        // `activeInterceptorId` in old chat metadata becomes an agent id unchanged.
        id: interceptor.id,
        name: interceptor.name || 'Interceptor',
        description: 'Migrated from interceptors.',
        utility: true,
        // Legacy interceptors stored a bare model id and resolved it by scanning every
        // provider. AgentRegistry.resolveModel does the same when providerId is empty.
        providerId: '',
        modelId: interceptor.modelId || '',
        prompts: interceptor.systemPrompt
          ? [{ type: 'text', value: interceptor.systemPrompt }]
          : [],
        maxDelegateDepth: 0,
      })
    )
  }

  ai.agents = agents
  ai.defaultAgentId = base.id
  return true
}

/**
 * What a comment agent is for, in the shortest form that gets the behaviour.
 *
 * Length is the point: the whole reason a comment exists is that the answer belongs beside
 * the passage, and an agent that opens with three paragraphs and a tour of the vault has
 * missed it.
 */
export const COMMENT_AGENT_PROMPT = [
  'You are answering inside a note, in a comment pinned next to a passage of it.',
  'Answer briefly and in place — a sentence or two where that is enough, as if written in the margin.',
  'The selected text and the note around it are given to you below; they are your context, so work from them rather than going looking for them.',
  'When the person asks for the passage itself to be changed, use `edit_selection`: it rewrites the text this comment is attached to, and nothing else in the note.',
  'Prefer answering from what is in front of you over touring the vault; search only when the question truly cannot be answered without it.',
].join(' ')

/**
 * The agent comment chats run on, unless the person points the setting somewhere else.
 *
 * Created once and left alone afterwards — it is an ordinary agent from that moment, editable
 * and deletable like any other, so nothing here reaches back in to correct it.
 */
export function ensureCommentAgent(ai: AiSettings): boolean {
  if (ai.commentAgentId) return false
  if (!ai.agents) ai.agents = []

  const agent = createAgent({
    name: 'Comment',
    description: 'Answers comment chats anchored in a note.',
    // Not in the chat agent picker: it is chosen by the comment setting, not per chat.
    utility: true,
    providerId: ai.activeProviderId || '',
    modelId: ai.activeModelId || '',
    prompts: [{ type: 'text', value: COMMENT_AGENT_PROMPT }],
    // Core writes — edit, create, rm, mv — ask under this mode. That is the "write tools ask"
    // half of the spec; `edit_selection` carries its own mode below.
    permissionMode: 'confirm-all',
    toolModes: {
      web_search: 'auto',
      fetch: 'auto',
      read_logs: 'auto',
      read_backlinks: 'auto',
      read_tasks: 'auto',
      read_transactions: 'auto',
      chart_docs: 'auto',
      template_docs: 'auto',
      [EDIT_SELECTION_TOOL]: 'ask',
    },
    // The note it is anchored to is added to the scope by the session, which is the whole
    // restriction: "no other files" is a scope, not a tool ban.
    scope: [],
    fullVaultAccess: false,
    skillsMode: 'all',
    // A comment is a short exchange in a margin; delegating out of one has nowhere to report.
    maxDelegateDepth: 0,
  })

  ai.agents.push(agent)
  ai.commentAgentId = agent.id
  return true
}

/**
 * Returns whether anything was changed, because migration touches the in-memory settings only.
 *
 * The caller is what writes them. Without that a vault that already had agents would seed a
 * fresh Comment agent on every single launch — a new id each time, leaving every comment file
 * written before the next save pointing at an agent that no longer exists.
 */
/**
 * Hands the map tools to agents that existed before there were any.
 *
 * They need no key and no account, so a switch nobody knew to flick is the only thing that
 * would stand between a person and asking where something is. Only agents with no opinion on
 * the tool are touched — an `off` written by hand is an opinion and stays.
 */
function enableMapTools(ai: AiSettings): boolean {
  let changed = false

  for (const agent of ai.agents || []) {
    for (const tool of MAP_TOOLS) {
      if (agent.toolModes[tool] !== undefined) continue
      agent.toolModes[tool] = 'auto'
      changed = true
    }
  }

  return changed
}

/**
 * Switches memory on for agents saved before it existed. Same rule as the map tools: only an
 * agent with no opinion is touched, and an `off` written by hand stays off.
 *
 * `forget` came later and takes whatever `remember` has on that agent: someone who switched
 * memory off for an agent did not mean to hand it a way to change memory instead.
 */
function enableMemoryTool(ai: AiSettings): boolean {
  let changed = false

  for (const agent of ai.agents || []) {
    if (agent.toolModes[REMEMBER_TOOL] === undefined) {
      agent.toolModes[REMEMBER_TOOL] = 'auto'
      changed = true
    }
    if (agent.toolModes[FORGET_TOOL] === undefined) {
      agent.toolModes[FORGET_TOOL] = agent.toolModes[REMEMBER_TOOL]
      changed = true
    }
  }

  return changed
}

/**
 * Hands the GitHub tools to agents saved before they existed. They read and nothing more, and
 * they are only offered while the GitHub integration is on — so an agent with no opinion gets
 * them, and an `off` written by hand stays off.
 */
function enableGithubTools(ai: AiSettings): boolean {
  let changed = false

  for (const agent of ai.agents || []) {
    for (const tool of GITHUB_TOOLS) {
      if (agent.toolModes[tool] !== undefined) continue
      agent.toolModes[tool] = 'auto'
      changed = true
    }
  }

  return changed
}

/**
 * Hands the book tools to agents saved before they had their modes: reading on its own, marking
 * a book after asking. Only a tool an agent has no opinion on is touched — one switched on or off
 * by hand stays as it is.
 */
function enableBookTools(ai: AiSettings): boolean {
  let changed = false

  for (const agent of ai.agents || []) {
    for (const [tool, mode] of Object.entries(BOOK_TOOL_MODES)) {
      if (agent.toolModes[tool] !== undefined) continue
      agent.toolModes[tool] = mode
      changed = true
    }
  }

  return changed
}

/**
 * Gives every agent a well-formed interceptor pair.
 *
 * Filling in the missing fields is not reported as a change: agents saved before the field
 * existed mean "no interceptor", and that is what the blank says. What is reported is a value
 * that was wrong — a non-string, an agent reviewing itself, a depth no picker offers — because
 * that one is corrected and the file should stop saying it.
 *
 * A reference to an agent that does not exist is left alone: settings arriving from another
 * device can name one that is imported a moment later, and until then it simply reviews nothing.
 */
function normaliseInterceptors(ai: AiSettings): boolean {
  let changed = false

  for (const agent of ai.agents || []) {
    const raw = agent as { interceptorAgentId?: unknown; interceptorContextDepth?: unknown }

    if (raw.interceptorAgentId === undefined) {
      agent.interceptorAgentId = ''
    } else if (typeof raw.interceptorAgentId !== 'string' || raw.interceptorAgentId === agent.id) {
      agent.interceptorAgentId = ''
      changed = true
    }

    if (raw.interceptorContextDepth === undefined) {
      agent.interceptorContextDepth = 0
    } else {
      const depth = normaliseContextDepth(raw.interceptorContextDepth)
      if (depth !== raw.interceptorContextDepth) {
        agent.interceptorContextDepth = depth
        changed = true
      }
    }
  }

  return changed
}

export function migrateAgents(ai: AiSettings): boolean {
  const legacy = migrateLegacyAgents(ai)
  // Outside the legacy migration on purpose: that one is a no-op the moment any agent exists,
  // and a vault that has had agents since before comments still needs this one.
  const comment = ensureCommentAgent(ai)
  const maps = enableMapTools(ai)
  const memory = enableMemoryTool(ai)
  const github = enableGithubTools(ai)
  const books = enableBookTools(ai)
  const interceptors = normaliseInterceptors(ai)

  return legacy || comment || maps || memory || github || books || interceptors
}
