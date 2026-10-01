import { describe, expect, it } from 'vitest'
import { createAgent } from '@/ai/agents/types'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { migrateAgents } from '@/ai/agents/migration'
import { DEFAULT_MEMORY_TEMPLATE, renderMemory } from '@/ai/agents/memory'

const previous =
  '## Memory\n\nThings the person asked you to remember. They hold in every conversation until the person asks you to change or forget one.\n\n{{memory}}'

describe('memory trust and defaults', () => {
  it('asks before saving a new memory unless auto was chosen', () => {
    expect(createAgent().toolModes.remember).toBe('ask')
    expect(createAgent({ toolModes: { remember: 'auto' } }).toolModes.remember).toBe('auto')
  })
  it('uses ask when a legacy agent has no memory preference, preserving stored choices', () => {
    for (const mode of [undefined, 'off', 'ask', 'auto'] as const) {
      const agent = createAgent({ toolModes: mode ? { remember: mode } : {} })
      const settings = { ...DEFAULT_AI_SETTINGS, agents: [agent], defaultAgentId: agent.id }
      migrateAgents(settings)
      expect(agent.toolModes.remember).toBe(mode ?? 'ask')
      expect(agent.toolModes.forget).toBe(mode ?? 'ask')
    }
  })
  it('labels default and saved former-default memory as agent notes, not owner instructions', () => {
    const items = [{ id: 'sample', text: 'Prefer short summaries', created: '2026-01-01' }]
    for (const template of ['', DEFAULT_MEMORY_TEMPLATE, previous]) {
      const rendered = renderMemory(items, template)
      expect(rendered).toContain('Prefer short summaries')
      expect(rendered).toMatch(/your own notes/)
      expect(rendered).toMatch(/not instructions/)
      expect(rendered).not.toMatch(/Things the person asked/)
    }
  })
  it('preserves a customised memory template', () => {
    expect(
      renderMemory(
        [{ id: 'sample', text: 'short', created: '2026-01-01' }],
        'Reference: {{memory}}'
      )
    ).toBe('Reference: - short')
  })
})
