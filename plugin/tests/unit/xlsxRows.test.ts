import { describe, expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookRows } from '@/spreadsheet/rows'
import { sampleParts, sampleXlsx, sheetXml } from '../fixtures/xlsx/sampleXlsx'
const simple = () => {
  const parts = sampleParts()
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    sheetXml('<row r="1"><c r="A1"><v>5</v></c></row><row r="6"><c r="A6"><v>7</v></c></row>')
  )
  parts['xl/worksheets/sheet2.xml'] = strToU8(sheetXml(''))
  return zipSync(parts)
}
describe('safe trailing worksheet rows', () => {
  it('appends blank rows at the end and removes only the last rows in a simple value-only workbook', async () => {
    const bytes = simple()
    const appended = await applyWorkbookRows(await openXlsx(bytes), {
      operation: 'row_add',
      sheet: 'Sample',
      rows: 2,
    })
    const book = await openXlsx(appended)
    expect((await book.sheet('Sample')).maxRow).toBe(8)
    expect((await book.sheet('Sample')).source).toContain('r="8"')
    const deleted = await applyWorkbookRows(book, {
      operation: 'row_delete',
      sheet: 'Sample',
      rows: 3,
    })
    const sheet = await (await openXlsx(deleted)).sheet('Sample')
    expect(sheet.maxRow).toBe(5)
    expect(sheet.cells.has('A6')).toBe(false)
    expect(sheet.cells.get('A1')?.value).toBe(5)
    const before = unzipSync(bytes)
    const after = unzipSync(deleted)
    for (const name of Object.keys(before))
      if (!['xl/worksheets/sheet1.xml', 'xl/workbook.xml'].includes(name))
        expect(after[name], name).toEqual(before[name])
  })
  it('refuses destructive row deletion where formulas or structural references would need rewriting', async () => {
    await expect(
      applyWorkbookRows(await openXlsx(sampleXlsx()), { operation: 'row_delete', sheet: 'Sample' })
    ).rejects.toThrow(/formula|structur/i)
    await expect(
      applyWorkbookRows(await openXlsx(simple(), true), { operation: 'row_add', sheet: 'Sample' })
    ).rejects.toThrow(/read-only/)
    await expect(
      applyWorkbookRows(await openXlsx(simple()), {
        operation: 'row_delete',
        sheet: 'Sample',
        rows: 6,
      })
    ).rejects.toThrow(/one row|row count/)
  })
})
