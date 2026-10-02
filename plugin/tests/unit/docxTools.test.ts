import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocxTools, namedDocx } from '@/ai/tools/DocxTools'
import { sampleDocx, SAMPLE_IMAGE } from '../fixtures/docx/sampleDocx'
import { wordRevision } from '@/word/write'
import { openDocx } from '@/word/package'
import { ScopeResolver } from '@/ai/ScopeResolver'
import type { ToolContext } from '@/ai/toolContext'
import { DOCX_VIEW_TYPE } from '@/word/DocxView'
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
describe('Word tools — call-local scope', () => {
  const FIRST = 'Documents/sample.docx'
  const SECOND = 'Private/sample.docx'
  const IMAGE = 'Private/sample.png'
  const context = (path: string): ToolContext => {
    const scope = new ScopeResolver()
    scope.addFile(path)
    return { scope, interactive: true }
  }

  it.each(['docx_read', 'docx_search', 'docx_edit'])(
    '%s cannot borrow another chat or the default scope',
    async (name) => {
      const app = useVault([])
      const bytes = sampleDocx()
      await app.vault.createBinary(FIRST, bytes.buffer as ArrayBuffer)
      await app.vault.createBinary(SECOND, bytes.buffer as ArrayBuffer)
      const first = context(FIRST)
      const second = context(SECOND)
      ScopeResolver.getInstance().setFullVaultAccess(true)
      const tool = createDocxTools().find((t) => t.name === name)!
      const params = (path: string) => ({
        path,
        query: 'report',
        revision: wordRevision(bytes),
        operation: 'replace',
        paragraph: 1,
        old_text: 'report',
        new_text: 'summary',
      })
      await expect(tool.execute('sample-denied', params(SECOND), undefined, first)).rejects.toThrow(
        /Access denied/
      )
      await expect(tool.execute('sample-denied', params(FIRST), undefined, second)).rejects.toThrow(
        /Access denied/
      )
      expect(app.stats.modify).toBe(0)
      ScopeResolver.getInstance().clear()
      const results = await Promise.all([
        tool.execute('sample-first', params(FIRST), undefined, first),
        tool.execute('sample-second', params(SECOND), undefined, second),
      ])
      expect(results[0].content[0].text).toContain(FIRST)
      expect(results[1].content[0].text).toContain(SECOND)
    }
  )

  it('lists only the Word tabs in the calling chat, not the default scope', async () => {
    const app = useVault([{ path: FIRST }, { path: SECOND }])
    const leaves = [FIRST, SECOND].map((path) => ({
      view: { file: app.vault.getFileByPath(path), paragraph: 1 },
    }))
    Object.assign(app, {
      workspace: { getLeavesOfType: vi.fn((type) => (type === DOCX_VIEW_TYPE ? leaves : [])) },
    })
    ScopeResolver.getInstance().setFullVaultAccess(true)
    const tool = createDocxTools().find((t) => t.name === 'docx_views')!
    const first = await tool.execute('sample-first', {}, undefined, context(FIRST))
    const second = await tool.execute('sample-second', {}, undefined, context(SECOND))
    expect(first.content[0].text).toContain(FIRST)
    expect(first.content[0].text).not.toContain(SECOND)
    expect(second.content[0].text).toContain(SECOND)
    expect(second.content[0].text).not.toContain(FIRST)
  })

  it.each(['image_insert', 'image_replace'])(
    '%s checks the source image against the calling scope',
    async (operation) => {
      const app = useVault([])
      const bytes = sampleDocx()
      await app.vault.createBinary(FIRST, bytes.buffer as ArrayBuffer)
      await app.vault.createBinary(IMAGE, SAMPLE_IMAGE.buffer as ArrayBuffer)
      const ctx = context(FIRST)
      ScopeResolver.getInstance().setFullVaultAccess(true)
      const tool = createDocxTools().find((t) => t.name === 'docx_edit')!
      const params = {
        path: FIRST,
        revision: wordRevision(bytes),
        operation,
        paragraph: (await openDocx(bytes)).images[0].paragraph,
        image: 1,
        image_path: IMAGE,
        width: 100,
        height: 100,
      }
      await expect(tool.execute('sample-image', params, undefined, ctx)).rejects.toThrow(
        /Access denied/
      )
      expect(app.stats.modify).toBe(0)
      ScopeResolver.getInstance().clear()
      ctx.scope.addFile(IMAGE)
      await tool.execute('sample-image-granted', params, undefined, ctx)
      expect(app.stats.modify).toBe(1)
    }
  )
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
    const scope = new ScopeResolver()
    scope.addFile('Documents/alias.docx')
    ScopeResolver.getInstance().setFullVaultAccess(true)
    expect(() => namedDocx('Documents/alias.docx', { scope, interactive: true })).toThrow(
      /Access denied/
    )
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
