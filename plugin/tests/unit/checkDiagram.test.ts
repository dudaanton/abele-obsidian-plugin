import { describe, it, expect } from 'vitest'
import { createCheckDiagramTool } from '@/ai/tools/CheckDiagramTool'
import { createAgent } from '@/ai/agents/types'
import { migrateAgents } from '@/ai/agents/migration'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

describe('check_diagram', () => {
  it('is automatic for new and saved agents and preserves an explicit mode', () => {
    expect(createAgent().toolModes.check_diagram).toBe('auto')
    const saved = createAgent()
    delete saved.toolModes.check_diagram
    const disabled = createAgent({ toolModes: { check_diagram: 'off' } })
    const settings = { ...DEFAULT_AI_SETTINGS, agents: [saved, disabled] }
    migrateAgents(settings)
    expect(saved.toolModes.check_diagram).toBe('auto')
    expect(disabled.toolModes.check_diagram).toBe('off')
  })
  it('validates real source without writing a note', async () => {
    const tool = createCheckDiagramTool()
    const result = await tool.execute('test', { source: 'flowchart LR\n A --> B' })
    const value = JSON.parse((result.content[0] as { text: string }).text)
    expect(value).toMatchObject({ ok: true, type: 'flowchart' })
    expect(value.width).toBeGreaterThan(0)
  })
  it('returns the parser location and caret for invalid source', async () => {
    const result = await createCheckDiagramTool().execute('test', {
      source: 'flowchart LR\n A[broken',
    })
    const value = JSON.parse((result.content[0] as { text: string }).text)
    expect(value).toMatchObject({ ok: false })
    expect(value.line).toBeGreaterThan(0)
    expect(value.column).toBeGreaterThan(0)
    expect(value.snippet).toContain('^')
  })
})
