import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createXlsxTools, namedWorkbook } from '@/ai/tools/XlsxTools'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { createAgent } from '@/ai/agents/types'
import { useVault } from '../helpers/testEnv'
import { sampleXlsx } from '../fixtures/xlsx/sampleXlsx'

beforeEach(() => {
  useVault([])
  const scope = ScopeResolver.getInstance()
  scope.clear()
  scope.setFullVaultAccess(false)
  scope.addFolder('Documents')
})
describe('workbook tools', () => {
  it('resolve only scoped workbook paths, including the canonical path', () => {
    const app = useVault([
      { path: 'Documents/sample.xlsx', content: '' },
      { path: 'Private/sample.xlsx', content: '' },
      { path: 'Documents/sample.xls', content: '' },
    ])
    expect(namedWorkbook('Documents/sample.xlsx').path).toBe('Documents/sample.xlsx')
    expect(() => namedWorkbook('Private/sample.xlsx')).toThrow(/Access denied/)
    expect(() => namedWorkbook('Documents/sample.xls')).toThrow(/xlsx/)
    vi.spyOn(app.vault, 'getAbstractFileByPath').mockReturnValue(
      app.vault.getAbstractFileByPath('Private/sample.xlsx')
    )
    expect(() => namedWorkbook('Documents/sample.xlsx')).toThrow(/Access denied/)
  })
  it('reads without an open tab, lists sheets, finds formulas, and bounds paged output', async () => {
    const app = useVault([])
    const bytes = sampleXlsx()
    await app.vault.createBinary('Documents/sample.xlsx', bytes.buffer as ArrayBuffer)
    const tools = createXlsxTools()
    const run = async (name: string, params: Record<string, unknown>) =>
      (
        await tools
          .find((t) => t.name === name)!
          .execute('sample-call', { path: 'Documents/sample.xlsx', ...params })
      ).content[0]
    expect(await run('xlsx_sheets', {})).toMatchObject({ text: expect.stringContaining('Sample') })
    expect(await run('xlsx_read', { sheet: 'Sample', range: 'A1:C2' })).toMatchObject({
      text: expect.stringContaining('SUM(B1:B2)'),
    })
    const page = await run('xlsx_read', { sheet: 'Sample', range: 'A1:C2', limit: 20 })
    expect(page).toMatchObject({ text: expect.stringContaining('Continue with offset 20') })
    expect(await run('xlsx_search', { query: 'SUM(' })).toMatchObject({
      text: expect.stringContaining('Sample!C1'),
    })
    await expect(run('xlsx_read', { sheet: 'Sample', range: 'A1:XFD1048576' })).rejects.toThrow(
      /large/
    )
    expect(app.stats.modify).toBe(0)
  })
  it('defaults read tools to automatic, but keeps independent modes', () => {
    expect(createAgent().toolModes).toMatchObject({
      xlsx_read: 'auto',
      xlsx_search: 'auto',
      xlsx_sheets: 'auto',
    })
    expect(createAgent({ toolModes: { xlsx_search: 'off' } }).toolModes.xlsx_search).toBe('off')
  })
})
