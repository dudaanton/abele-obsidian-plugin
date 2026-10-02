import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createXlsxTools, namedWorkbook } from '@/ai/tools/XlsxTools'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { createAgent } from '@/ai/agents/types'
import { useVault } from '../helpers/testEnv'
import { sampleXlsx } from '../fixtures/xlsx/sampleXlsx'
import { wordRevision } from '@/ooxml/write'
import { openXlsx } from '@/spreadsheet/package'

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
  it('writes against the read revision, refuses stale revisions, and serializes concurrent saves', async () => {
    const app = useVault([])
    const bytes = sampleXlsx()
    await app.vault.createBinary('Documents/sample.xlsx', bytes.buffer as ArrayBuffer)
    const tool = createXlsxTools().find((t) => t.name === 'xlsx_write')!
    const params = {
      path: 'Documents/sample.xlsx',
      revision: wordRevision(bytes),
      sheet: 'Sample',
      range: 'B2',
      values: [[25]],
    }
    const results = await Promise.allSettled([
      tool.execute('sample-one', params),
      tool.execute('sample-two', { ...params, values: [[30]] }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(app.stats.modify).toBe(1)
    await expect(tool.execute('sample-stale', params)).rejects.toThrow(/changed/)
    const now = new Uint8Array(await app.vault.readBinary(namedWorkbook(params.path)))
    expect((await (await openXlsx(now)).sheet('Sample')).cells.get('B2')?.value).toBe(25)
    expect((await (await openXlsx(now)).sheet('Sample')).cells.get('C1')?.value).toBe(35)
    expect((await (await openXlsx(now)).sheet('Other')).cells.get('A1')?.value).toBe(70)
    expect(createAgent().toolModes.xlsx_write).toBe('ask')
  })
  it('checks the compressed size before allocating a large vault attachment on a phone', async () => {
    const app = useVault([{ path: 'Documents/large.xlsx', content: '' }])
    const file = namedWorkbook('Documents/large.xlsx')
    file.stat.size = 32 * 1024 * 1024 + 1
    const read = vi.spyOn(app.vault, 'readBinary')
    await expect(
      createXlsxTools()
        .find((t) => t.name === 'xlsx_read')!
        .execute('sample-large', { path: file.path, sheet: 'Sample' })
    ).rejects.toThrow(/too large/)
    expect(read).not.toHaveBeenCalled()
  })
  it('refuses a workbook that becomes .xlsm while the optimistic write boundary is rereading it', async () => {
    const app = useVault([])
    const bytes = sampleXlsx()
    await app.vault.createBinary('Documents/sample.xlsx', bytes.buffer as ArrayBuffer)
    const file = namedWorkbook('Documents/sample.xlsx')
    const read = app.vault.readBinary.bind(app.vault)
    let calls = 0
    vi.spyOn(app.vault, 'readBinary').mockImplementation(async (f) => {
      const data = await read(f)
      if (++calls === 2) file.extension = 'xlsm'
      return data
    })
    await expect(
      createXlsxTools()
        .find((t) => t.name === 'xlsx_write')!
        .execute('sample-renamed', {
          path: file.path,
          revision: wordRevision(bytes),
          sheet: 'Sample',
          range: 'B2',
          values: [[25]],
        })
    ).rejects.toThrow(/read-only/)
    expect(app.stats.modify).toBe(0)
  })
  it('reads .xlsm but never writes it, even when the requested edit looks like an ordinary cell', async () => {
    const app = useVault([])
    const bytes = sampleXlsx()
    await app.vault.createBinary('Documents/sample.xlsm', bytes.buffer as ArrayBuffer)
    const tools = createXlsxTools()
    expect(
      (
        await tools
          .find((t) => t.name === 'xlsx_sheets')!
          .execute('sample-macro-read', { path: 'Documents/sample.xlsm' })
      ).content[0]
    ).toMatchObject({ text: expect.stringContaining('read-only') })
    await expect(
      tools
        .find((t) => t.name === 'xlsx_write')!
        .execute('sample-macro-write', {
          path: 'Documents/sample.xlsm',
          revision: wordRevision(bytes),
          sheet: 'Sample',
          range: 'B2',
          values: [[25]],
        })
    ).rejects.toThrow(/read-only/)
    expect(app.stats.modify).toBe(0)
  })
  it('bounds search excerpts even when the matching query itself is very long', async () => {
    const app = useVault([])
    const query = 'q'.repeat(1000)
    const bytes = sampleXlsx(
      Array.from(
        { length: 40 },
        (_, i) =>
          `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${query}</t></is></c></row>`
      ).join('')
    )
    await app.vault.createBinary('Documents/sample.xlsx', bytes.buffer as ArrayBuffer)
    const result = await createXlsxTools()
      .find((t) => t.name === 'xlsx_search')!
      .execute('sample-long-search', { path: 'Documents/sample.xlsx', query, limit: 40 })
    expect(result.content[0].text!.length).toBeLessThan(25000)
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
