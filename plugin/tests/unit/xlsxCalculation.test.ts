import { describe, expect, it, vi } from 'vitest'
import { HyperFormula } from 'hyperformula'
import { prepareWorkbookChange } from '@/spreadsheet/vaultAdapter'
import { wordRevision } from '@/ooxml/write'
import { useVault } from '../helpers/testEnv'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookEdit } from '@/spreadsheet/edit'
import { recalculateWorkbook } from '@/spreadsheet/calculation'
import { sampleXlsx, sampleParts, sheetXml } from '../fixtures/xlsx/sampleXlsx'

describe('local workbook recalculation', () => {
  it('refuses huge sparse dependency ranges before constructing the engine, including during write preview', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml(
        '<row r="1"><c r="A1"><f>SUM(B1:XFD1048576)</f><v>4</v></c><c r="B1"><v>1</v></c></row>'
      )
    )
    const original = zipSync(parts)
    const engine = vi.spyOn(HyperFormula, 'buildEmpty').mockImplementation(() => {
      throw new Error('unbounded engine allocation')
    })
    try {
      const calculated = await recalculateWorkbook(await openXlsx(original))
      expect(calculated.bytes).toBe(original)
      expect(calculated.complete).toBe(false)
      expect(calculated.note).toMatch(/limit|not recalculated/i)
      const app = useVault([])
      const file = await app.vault.createBinary('sample.xlsx', original.buffer as ArrayBuffer)
      const preview = await prepareWorkbookChange(
        app,
        file,
        { sheet: 'Sample', range: 'B1', values: [[2]] },
        wordRevision(original)
      )
      expect(preview.calculation.complete).toBe(false)
      expect(preview.calculation.note).toMatch(/limit|not recalculated/i)
      expect((await (await openXlsx(preview.updated)).sheet('Sample')).cells.get('B1')?.value).toBe(
        2
      )
      expect(engine).not.toHaveBeenCalled()
      expect(app.stats.modify).toBe(0)
    } finally {
      engine.mockRestore()
    }
  })
  it('bounds whole-row, whole-column and named-expression ranges before engine initialization', async () => {
    const engine = vi.spyOn(HyperFormula, 'buildEmpty').mockImplementation(() => {
      throw new Error('unbounded engine allocation')
    })
    try {
      for (const formula of [
        'SUM(B:XFD)',
        'SUM(1:1048576)',
        'LargeRange+1',
        'INDIRECT("A1:XFD1048576")',
      ]) {
        const parts = sampleParts()
        parts['xl/workbook.xml'] = strToU8(
          strFromU8(parts['xl/workbook.xml']).replace(
            '<calcPr',
            '<definedNames><definedName name="LargeRange">Sample!B1:XFD1048576</definedName></definedNames><calcPr'
          )
        )
        parts['xl/worksheets/sheet1.xml'] = strToU8(
          sheetXml(`<row r="1"><c r="A1"><f>${formula}</f><v>4</v></c></row>`)
        )
        const original = zipSync(parts)
        const calculated = await recalculateWorkbook(await openXlsx(original))
        expect(calculated.complete, formula).toBe(false)
        expect(calculated.bytes, formula).toBe(original)
        expect(calculated.note, formula).toMatch(/limit|not recalculated/i)
      }
      expect(engine).not.toHaveBeenCalled()
    } finally {
      engine.mockRestore()
    }
  })
  it('escapes XML-forbidden calculated characters as Excel ST_Xstring and reopens the saved value', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml('<row r="1"><c r="A1"><f>CHAR(1)</f></c><c r="B1"><f>CHAR(13)</f></c></row>')
    )
    const result = await recalculateWorkbook(await openXlsx(zipSync(parts)))
    expect(result.complete).toBe(true)
    const xml = strFromU8(unzipSync(result.bytes)['xl/worksheets/sheet1.xml'])
    expect(xml).toContain('_x0001_')
    expect(xml).toContain('_x000D_')
    expect(xml).not.toContain('\u0001')
    expect((await (await openXlsx(result.bytes)).sheet('Sample')).cells.get('A1')?.value).toBe(
      '\u0001'
    )
  })
  it('does not rewrite equivalent explicit numeric types or escaped string caches when results are unchanged', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml(
        '<row r="1"><c r="A1" t="str"><f>"A"</f><v>_x0041_</v></c><c r="C1" t="n"><f>1+1</f><v>2.00</v></c></row>'
      )
    )
    parts['xl/worksheets/sheet2.xml'] = strToU8(sheetXml(''))
    const bytes = zipSync(parts)
    const result = await recalculateWorkbook(await openXlsx(bytes))
    expect(result.bytes).toBe(bytes)
  })
  it('uses the workbook date epoch rather than changing DATE results by a day or four years', async () => {
    for (const [date1904, expected] of [
      [false, 45292],
      [true, 43830],
    ] as const) {
      const parts = sampleParts()
      parts['xl/worksheets/sheet1.xml'] = strToU8(
        sheetXml('<row r="1"><c r="A1"><f>DATE(2024,1,1)</f></c></row>')
      )
      if (date1904)
        parts['xl/workbook.xml'] = strToU8(
          strFromU8(parts['xl/workbook.xml']).replace(
            '<bookViews>',
            '<workbookPr date1904="1"/><bookViews>'
          )
        )
      const calc = await recalculateWorkbook(await openXlsx(zipSync(parts)))
      expect((await (await openXlsx(calc.bytes)).sheet('Sample')).cells.get('A1')?.value).toBe(
        expected
      )
    }
  })
  it('recomputes dependent formulas across sheets and saves caches while preserving formula XML', async () => {
    const changed = await applyWorkbookEdit(await openXlsx(sampleXlsx()), {
      sheet: 'Sample',
      range: 'B2',
      values: [[25]],
    })
    const calc = await recalculateWorkbook(await openXlsx(changed))
    expect(calc.complete).toBe(true)
    const book = await openXlsx(calc.bytes)
    expect((await book.sheet('Sample')).cells.get('C1')).toMatchObject({
      formula: 'SUM(B1:B2)',
      value: 35,
    })
    expect((await book.sheet('Other')).cells.get('A1')?.value).toBe(70)
    const before = unzipSync(changed)
    const after = unzipSync(calc.bytes)
    expect(strFromU8(after['xl/worksheets/sheet1.xml'])).toContain('<f>SUM(B1:B2)</f>')
    for (const name of Object.keys(before))
      if (!name.startsWith('xl/worksheets/')) expect(after[name], name).toEqual(before[name])
  })
  it('returns #NAME? for unsupported functions and error caches for cyclic dependencies', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml(
        '<row r="1"><c r="A1"><f>SAMPLE.UNKNOWN(1)</f><v>8</v></c><c r="B1"><f>C1</f></c><c r="C1"><f>B1</f></c></row>'
      )
    )
    const calc = await recalculateWorkbook(await openXlsx(zipSync(parts)))
    const sheet = await (await openXlsx(calc.bytes)).sheet('Sample')
    expect(sheet.cells.get('A1')?.value).toBe('#NAME?')
    expect(sheet.cells.get('B1')?.value).toBe('#REF!')
    expect(calc.complete).toBe(false)
    expect(sheet.cells.get('A1')?.node.attrs.t).toBe('e')
  })
  it('preserves literal numeric/formula-looking text and supports defined names', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>=1+1</t></is></c><c r="B1"><f>A1</f></c><c r="C1"><f>SampleTotal*2</f></c></row><row r="2"><c r="B2"><v>5</v></c></row>'
      )
    )
    parts['xl/workbook.xml'] = strToU8(
      strFromU8(parts['xl/workbook.xml']).replace(
        '<calcPr',
        '<definedNames><definedName name="SampleTotal">Sample!$B$2</definedName></definedNames><calcPr'
      )
    )
    const calc = await recalculateWorkbook(await openXlsx(zipSync(parts)))
    const sheet = await (await openXlsx(calc.bytes)).sheet('Sample')
    expect(sheet.cells.get('B1')?.value).toBe('=1+1')
    expect(sheet.cells.get('C1')?.value).toBe(10)
  })
  it('leaves oversized calculations pending rather than constructing a dense million-row grid', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml('<row r="1048576"><c r="XFD1048576"><f>1+1</f><v>2</v></c></row>')
    )
    const book = await openXlsx(zipSync(parts))
    const calc = await recalculateWorkbook(book)
    expect(calc.complete).toBe(true)
    expect(
      (await (await openXlsx(calc.bytes)).sheet('Sample')).cells.get('XFD1048576')?.value
    ).toBe(2)
    const original = sampleXlsx()
    const limited = await recalculateWorkbook(await openXlsx(original), { maxCells: 1 })
    expect(limited.bytes).toBe(original)
    expect(limited.complete).toBe(false)
    expect(limited.note).toMatch(/limit/i)
  })
})
