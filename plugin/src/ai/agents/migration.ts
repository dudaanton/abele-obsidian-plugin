import { createAgent, type AgentDefinition } from './types'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'

/**
 * Folds the pre-agent global configuration into agent entities.
 *
 * Runs once: the moment `ai.agents` is non-empty this is a no-op, so a user who has since
 * renamed or deleted the migrated agents never gets them resurrected. The legacy fields are
 * deliberately left in place — settings UI still edits them until phases 3 and 5 remove it.
 */
export function migrateAgents(ai: AiSettings): void {
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
