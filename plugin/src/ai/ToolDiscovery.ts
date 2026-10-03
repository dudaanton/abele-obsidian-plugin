import type { AgentTool } from './client/types'

export const ENABLE_TOOLS = 'enable_tools'
export const ENABLE_TOOLS_DESCRIPTION =
  'Reveal the enabled tools of a group for the rest of this conversation. Call with an exact group name below, then use its tools in the next request. This does not change permissions: Off stays unavailable and Ask still needs approval.'

export interface ToolGroupInfo {
  name: string
  label: string
  category: string
}

/** Conversation-owned discovery state. No platform or storage dependency; permissions are filtered by the caller. */
export class ToolDiscovery {
  private groups: string[]

  constructor(revealed: readonly string[] = []) {
    this.groups = [
      ...new Set((Array.isArray(revealed) ? revealed : []).filter((g) => typeof g === 'string')),
    ]
  }

  get revealed(): string[] {
    return [...this.groups]
  }

  /** The core prefix is stable; groups append in reveal order, never in registry order. */
  offer(
    allowed: AgentTool[],
    metadata: readonly ToolGroupInfo[],
    core: ReadonlySet<string>,
    persist: () => Promise<void>
  ): AgentTool[] {
    const info = new Map(metadata.map((t) => [t.name, t]))
    const grouped = new Map<string, AgentTool[]>()
    const initial: AgentTool[] = []
    for (const tool of allowed) {
      if (core.has(tool.name)) {
        initial.push(tool)
        continue
      }
      const category = info.get(tool.name)?.category ?? tool.category ?? 'Other'
      const group = grouped.get(category) ?? []
      group.push(tool)
      grouped.set(category, group)
    }
    if (!grouped.size) return initial

    // Keep even revealed groups in the description: removing them would invalidate the prefix
    // on every reveal. Schemas and descriptions do not otherwise change between requests.
    const lines = [...grouped].map(([name, tools]) => {
      const labels = tools.slice(0, 3).map((t) => info.get(t.name)?.label ?? t.label ?? t.name)
      return `${name}: ${labels.join(', ')}${tools.length > 3 ? `; ${tools.length - 3} more` : ''}`
    })
    initial.push({
      name: ENABLE_TOOLS,
      label: 'Enable tool group',
      description: `${ENABLE_TOOLS_DESCRIPTION}\n\nAvailable groups:\n${lines.join('\n')}`,
      parameters: {
        type: 'object',
        properties: { group: { type: 'string', description: 'Exact available group name.' } },
        required: ['group'],
        additionalProperties: false,
      },
      execute: async (_id, params) => {
        const group = params.group
        const members = typeof group === 'string' ? grouped.get(group) : undefined
        if (typeof group !== 'string' || !members)
          throw new Error('Unknown or unavailable tool group')
        if (!this.groups.includes(group)) {
          this.groups.push(group)
          await persist()
        }
        return {
          content: [
            {
              type: 'text',
              text: `Enabled ${group}: ${members.map((t) => t.name).join(', ')}. Available from the next request; existing permissions still apply.`,
            },
          ],
        }
      },
    })
    for (const name of this.groups) initial.push(...(grouped.get(name) ?? []))
    return initial
  }
}
