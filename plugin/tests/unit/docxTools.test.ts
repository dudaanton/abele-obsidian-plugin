import { beforeEach, describe, expect, it } from 'vitest'
import { namedDocx } from '@/ai/tools/DocxTools'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { createAgent } from '@/ai/agents/types'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([
    { path: 'Documents/sample.docx', content: '' },
    { path: 'Private/sample.docx', content: '' },
    { path: 'Documents/sample.txt', content: '' },
  ])
  const scope = ScopeResolver.getInstance()
  scope.clear()
  scope.setFullVaultAccess(false)
  scope.addFolder('Documents')
})
describe('Word tools', () => {
  it('only resolve binary Word files inside scope', () => {
    expect(namedDocx('Documents/sample.docx').path).toBe('Documents/sample.docx')
    expect(() => namedDocx('Private/sample.docx')).toThrow(/Access denied/)
    expect(() => namedDocx('Documents/sample.txt')).toThrow(/docx/)
  })
  it('provide independent per-agent modes without making them core tools', () => {
    const agent = createAgent()
    expect(agent.toolModes.docx_read).toBe('auto')
    expect(agent.toolModes.docx_search).toBe('auto')
    expect(agent.toolModes.docx_views).toBe('auto')
    const changed = createAgent({ toolModes: { docx_read: 'off', docx_search: 'ask' } })
    expect(changed.toolModes.docx_read).toBe('off')
    expect(changed.toolModes.docx_search).toBe('ask')
  })
})
