import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookFormat } from '@/spreadsheet/format'
import { sampleXlsx } from '../fixtures/xlsx/sampleXlsx'

describe('workbook cell formatting', () => {
  it('appends styles and patches only selected style attributes while keeping old font/fill/xf records verbatim', async () => {
    const bytes = sampleXlsx()
    const book = await openXlsx(bytes)
    const after = await applyWorkbookFormat(book, {
      sheet: 'Sample',
      range: 'B1:B2',
      format: { bold: true, italic: true, fill: '#33AA77', number_format: '0.00%' },
    })
    const reopened = await openXlsx(after)
    const sheet = await reopened.sheet('Sample')
    expect(sheet.cells.get('B1')?.style).toMatchObject({
      bold: true,
      italic: true,
      fill: '#33AA77',
      numberFormat: '0.00%',
    })
    expect(sheet.cells.get('B1')?.value).toBe(10)
    expect(sheet.cells.get('B2')?.styleId).toBe(sheet.cells.get('B1')?.styleId)
    const before = unzipSync(bytes)
    const parts = unzipSync(after)
    for (const name of Object.keys(before))
      if (!['xl/worksheets/sheet1.xml', 'xl/styles.xml'].includes(name))
        expect(parts[name], name).toEqual(before[name])
    const originalStyles = strFromU8(before['xl/styles.xml'])
    const styles = strFromU8(parts['xl/styles.xml'])
    for (const record of [
      '<font><b/><i/><sz val="11"/></font>',
      '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    ]) {
      expect(originalStyles).toContain(record)
      expect(styles).toContain(record)
    }
    expect(sheet.source).toContain('<c r="C1"><f>SUM(B1:B2)</f><v>30</v></c>')
  })
  it('can remove bold/italic/fill, add a custom number format, and style a missing cell', async () => {
    const book = await openXlsx(sampleXlsx())
    const after = await applyWorkbookFormat(book, {
      sheet: 'Sample',
      range: 'A1',
      format: { bold: false, italic: false, fill: '', number_format: '$#,##0.000' },
    })
    const sheet = await (await openXlsx(after)).sheet('Sample')
    expect(sheet.cells.get('A1')?.style).toMatchObject({
      bold: false,
      italic: false,
      fill: undefined,
      numberFormat: '$#,##0.000',
    })
    const next = await applyWorkbookFormat(await openXlsx(after), {
      sheet: 'Sample',
      range: 'D3',
      format: { bold: true },
    })
    expect((await (await openXlsx(next)).sheet('Sample')).cells.get('D3')?.style.bold).toBe(true)
  })
  it('retains the original ZIP for no-op formatting and validates colour and format inputs', async () => {
    const bytes = sampleXlsx()
    const book = await openXlsx(bytes)
    expect(
      await applyWorkbookFormat(book, { sheet: 'Sample', range: 'A1', format: { bold: true } })
    ).toBe(bytes)
    await expect(
      applyWorkbookFormat(book, { sheet: 'Sample', range: 'A1', format: { fill: 'url(sample)' } })
    ).rejects.toThrow(/colour|color/i)
    await expect(
      applyWorkbookFormat(book, {
        sheet: 'Sample',
        range: 'A1',
        format: { number_format: 'bad\u0000' },
      })
    ).rejects.toThrow(/XML/)
    await expect(
      applyWorkbookFormat(await openXlsx(bytes, true), {
        sheet: 'Sample',
        range: 'A1',
        format: { bold: false },
      })
    ).rejects.toThrow(/read-only/)
  })
})
