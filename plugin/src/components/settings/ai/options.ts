import { t } from '@/i18n'
import type { AgentDefinition } from '@/ai/agents/types'

export const PERMISSION_OPTIONS = [
  {
    value: 'confirm-all',
    get display() {
      return t('settings.ai.options.ask_before_every_change.f5fb08f2')
    },
  },
  {
    value: 'allow-edit',
    get display() {
      return t('settings.ai.options.edit_files_without_asking.08674c9f')
    },
  },
  {
    value: 'allow-all',
    get display() {
      return t('settings.ai.options.everything_without_asking.d14adf38')
    },
  },
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
        label: agent.name,
        display: agent.utility
          ? t('settings.ai.options.value_utility.6fb6bae8', { value0: String(agent.name) })
          : agent.name,
      })),
    ...scripts.map((name) => ({
      value: `${SCRIPT_KEY}${name}`,
      display: t('settings.ai.options.script_value_value.97c5d924', {
        value0: String(name),
        value1: String(knownScripts.includes(name) ? '' : t('settings.terms.missingSuffix')),
      }),
    })),
  ]
}
