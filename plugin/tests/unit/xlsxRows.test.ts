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
  it('appends after an empty styled row not listed in the dimension, retaining its properties', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml(
        '<row r="1"><c r="A1"><v>5</v></c></row><row r="2" ht="30" hidden="1" customHeight="1"/>'
      ).replace('A1:D6', 'A1:A1')
    )
    const original = zipSync(parts)
    const sheet = await (await openXlsx(original)).sheet('Sample')
    expect(sheet.maxRow).toBe(2)
    const updated = await applyWorkbookRows(await openXlsx(original), {
      operation: 'row_add',
      sheet: 'Sample',
    })
    const next = await (await openXlsx(updated)).sheet('Sample')
    expect(next.maxRow).toBe(3)
    expect(next.source).toContain('<row r="2" ht="30" hidden="1" customHeight="1"/>')
    expect(next.source).toContain(
      '<row xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" r="3"'
    )
    expect(next.source).not.toContain(
      '<row xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" r="2"'
    )
  })
  it('rejects duplicate or out-of-order empty rows before exposing them to editing', async () => {
    for (const rows of [
      '<row r="1"/><row r="2" ht="30"/><row r="2" hidden="1"/>',
      '<row r="3"/><row r="2"/>',
    ]) {
      const parts = sampleParts()
      parts['xl/worksheets/sheet1.xml'] = strToU8(sheetXml(rows))
      const book = await openXlsx(zipSync(parts))
      await expect(book.sheet('Sample')).rejects.toThrow(/row/i)
    }
  })
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
