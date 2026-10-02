import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { openXlsx } from '@/spreadsheet/package'
import { cellAddress, parseRange } from '@/spreadsheet/address'
import { formatValue } from '@/spreadsheet/styles'
import { sampleXlsx, sampleParts, sheetXml } from '../fixtures/xlsx/sampleXlsx'

describe('workbook reader', () => {
  it('loads sheets lazily and indexes cached values, formulas, merges, widths and frozen rows', async () => {
    const book = await openXlsx(sampleXlsx())
    expect(book.sheets.map((s) => s.name)).toEqual(['Sample', 'Other'])
    expect(book.loaded.size).toBe(0)
    const sheet = await book.sheet('Sample')
    expect(sheet.cells.get('A1')?.value).toBe('Sample heading')
    expect(sheet.cells.get('C1')).toMatchObject({ value: 30, formula: 'SUM(B1:B2)' })
    expect(sheet.cells.get('A1')?.style).toMatchObject({
      bold: true,
      italic: true,
      fill: '#FFCC00',
    })
    expect(
      formatValue(sheet.cells.get('D2')!.value, sheet.cells.get('D2')!.style.numberFormat, false)
    ).toBe('2024-01-01')
    expect(sheet.merges).toEqual([parseRange('A4:B4')])
    expect(sheet.columnWidths.get(1)).toBeGreaterThan(100)
    expect(sheet.frozenRows).toBe(1)
    expect(book.loaded.size).toBe(1)
  })
  it('uses relationship paths rather than assumed sheet filenames', async () => {
    const parts = sampleParts()
    parts['xl/_rels/workbook.xml.rels'] = strToU8(
      new TextDecoder()
        .decode(parts['xl/_rels/workbook.xml.rels'])
        .replace('worksheets/sheet1.xml', 'worksheets/renamed.xml')
    )
    parts['xl/worksheets/renamed.xml'] = parts['xl/worksheets/sheet1.xml']
    delete parts['xl/worksheets/sheet1.xml']
    const book = await openXlsx(zipSync(parts))
    expect((await book.sheet('Sample')).cells.get('B2')?.value).toBe(20)
  })
  it('rejects dangerous XML, relationship paths, invalid ranges and oversized archives', async () => {
    const parts = sampleParts()
    parts['xl/workbook.xml'] = strToU8('<!DOCTYPE workbook><workbook/>')
    await expect(openXlsx(zipSync(parts))).rejects.toThrow(/DOCTYPE/)
    await expect(openXlsx(new Uint8Array(32 * 1024 * 1024 + 1))).rejects.toThrow(/large/)
    expect(() => parseRange('A0:XFE2')).toThrow()
    expect(cellAddress(1048576, 16384)).toBe('XFD1048576')
    parts['xl/workbook.xml'] = sampleParts()['xl/workbook.xml']
    parts['xl/_rels/workbook.xml.rels'] = strToU8(
      new TextDecoder()
        .decode(parts['xl/_rels/workbook.xml.rels'])
        .replace('worksheets/sheet1.xml', '../../escape.xml')
    )
    await expect(openXlsx(zipSync(parts))).rejects.toThrow(/path/)
  })
  it('reads shared formulas as translated formulas and missing caches as pending', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml(
        '<row r="1"><c r="B1"><f t="shared" si="0" ref="B1:B2">A1+$A$3</f><v>3</v></c></row><row r="2"><c r="B2"><f t="shared" si="0"/></c></row>'
      )
    )
    const sheet = await (await openXlsx(zipSync(parts))).sheet('Sample')
    expect(sheet.cells.get('B2')?.formula).toBe('A2+$A$3')
    expect(sheet.cells.get('B2')?.value).toBe(null)
  })
})
