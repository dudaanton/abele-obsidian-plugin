import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { reasonLabel, type AttentionReason } from '@/agents/attention'

describe('agents list uses the plugin UI language', () => {
  it.each([
    'src/components/AgentsListDialog.vue',
    'src/components/AgentsButton.vue',
    'src/components/LocalAttentionPanel.vue',
    'src/agents/AgentsService.ts',
    'src/agents/attention.ts',
    'src/testing/agentsFixture.ts',
  ])('keeps built-in copy and synthetic examples in English: %s', (path) => {
    expect(readFileSync(path, 'utf8')).not.toMatch(/[\u0400-\u04ff]/)
  })
  it.each([
    [{ kind: 'approval', text: 'edit' }, 'Permission needed: edit'],
    [{ kind: 'question' }, 'Waiting for a reply'],
    [{ kind: 'question', interrupted: true }, 'Work interrupted · Waiting for a reply'],
    [{ kind: 'error', text: 'Sample failure' }, 'Run failed: Sample failure'],
    [{ kind: 'interrupted' }, 'Work interrupted'],
    [{ kind: 'running' }, 'Working on this device'],
    [{ kind: 'delivery' }, 'Updating…'],
  ] as const)('names %j plainly', (reason, text) => {
    expect(reasonLabel({ ...reason, id: 'sample', at: 1 } as AttentionReason)).toBe(text)
  })
})
