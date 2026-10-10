import type { AgentDefinition } from '@/ai/agents/types'

export const PERMISSION_OPTIONS = [
  { value: 'confirm-all', display: 'Ask before every change' },
  { value: 'allow-edit', display: 'Edit files without asking' },
  { value: 'allow-all', display: 'Everything without asking' },
]

/** Script names cannot collide with agent ids. Stored values remain unchanged. */
export const SCRIPT_KEY = 'script:'

export function interceptorChoices(
  agents: AgentDefinition[],
  knownScripts: string[],
  chosenScript = '',
  excludeAgentId = ''
) {
  const scripts = [...knownScripts]
  if (chosenScript && !scripts.includes(chosenScript)) scripts.push(chosenScript)
  return [
    ...agents
      .filter((agent) => agent.id !== excludeAgentId)
      .map((agent) => ({
        value: agent.id,
        display: agent.utility ? `${agent.name} · utility` : agent.name,
      })),
    ...scripts.map((name) => ({
      value: `${SCRIPT_KEY}${name}`,
      display: `Script: ${name}${knownScripts.includes(name) ? '' : ' · missing'}`,
    })),
  ]
}
