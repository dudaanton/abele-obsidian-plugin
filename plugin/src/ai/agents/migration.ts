import { createAgent, type AgentDefinition } from './types'
import { DEFAULT_AI_SETTINGS, EDIT_SELECTION_TOOL, type AiSettings } from '@/ai/types'

/**
 * Folds the pre-agent global configuration into agent entities.
 *
 * Runs once: the moment `ai.agents` is non-empty this is a no-op, so a user who has since
 * renamed or deleted the migrated agents never gets them resurrected. The legacy fields are
 * deliberately left in place — settings UI still edits them until phases 3 and 5 remove it.
 */
function migrateLegacyAgents(ai: AiSettings): void {
  if (ai.agents?.length) return

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
export function ensureCommentAgent(ai: AiSettings): void {
  if (ai.commentAgentId) return
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
}

export function migrateAgents(ai: AiSettings): void {
  migrateLegacyAgents(ai)
  // Outside the legacy migration on purpose: that one is a no-op the moment any agent exists,
  // and a vault that has had agents since before comments still needs this one.
  ensureCommentAgent(ai)
}
