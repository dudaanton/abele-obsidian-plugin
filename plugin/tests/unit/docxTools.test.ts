import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocxTools, namedDocx } from '@/ai/tools/DocxTools'
import { sampleDocx, SAMPLE_IMAGE } from '../fixtures/docx/sampleDocx'
import { wordRevision } from '@/word/write'
import { openDocx } from '@/word/package'
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
  it('checks scope against the resolved file path too', () => {
    const app = useVault([
      { path: 'Private/sample.docx', content: '' },
      { path: 'Documents/alias.docx', content: '' },
    ])
    expect(ScopeResolver.getInstance().isInScope('Documents/alias.docx')).toBe(true)
    const file = app.vault.getAbstractFileByPath('Private/sample.docx')
    vi.spyOn(app.vault, 'getAbstractFileByPath').mockReturnValue(file)
    expect(() => namedDocx('Documents/alias.docx')).toThrow(/Access denied/)
  })
  it('writes against the read revision and refuses stale calls and out-of-scope image imports', async () => {
    const app = useVault([])
    const bytes = sampleDocx()
    await app.vault.createBinary('Documents/sample.docx', bytes.buffer as ArrayBuffer)
    await app.vault.createBinary('Private/sample.png', SAMPLE_IMAGE.buffer as ArrayBuffer)
    const tool = createDocxTools().find((t) => t.name === 'docx_edit')!
    const params = {
      path: 'Documents/sample.docx',
      revision: wordRevision(bytes),
      operation: 'replace',
      paragraph: 1,
      old_text: 'report',
      new_text: 'summary',
    }
    await tool.execute('sample-edit', params)
    expect(app.stats.modify).toBe(1)
    await expect(tool.execute('sample-stale', params)).rejects.toThrow(/changed/)
    const now = new Uint8Array(await app.vault.readBinary(namedDocx(params.path)))
    await expect(
      tool.execute('sample-image', {
        path: params.path,
        revision: wordRevision(now),
        operation: 'image_insert',
        paragraph: 1,
        image_path: 'Private/sample.png',
        width: 100,
        height: 100,
      })
    ).rejects.toThrow(/Access denied/)
    expect(app.stats.modify).toBe(1)
    expect((await openDocx(now)).paragraphs[0].text).toBe('Sample summary')
  })
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
