import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookEdit } from '@/spreadsheet/edit'
import { applyWorkbookFormat } from '@/spreadsheet/format'
import { applyCalculatedEdit } from '@/spreadsheet/calculation'
import { translateFormula } from '@/spreadsheet/address'
import { parseXml } from '@/ooxml/xml'
import { PackageMutation } from '@/ooxml/mutation'
import { MAX_XML } from '@/ooxml/package'
import { sampleParts, sampleXlsx, sheetXml, R } from '../fixtures/xlsx/sampleXlsx'

describe('workbook round-trip edge cases', () => {
  it('translates whole-column/whole-row shared references but not quoted strings, sheet names or functions', () => {
    expect(translateFormula('SUM(A:$B,1:$2)+LOG10(A1)+\'A1\'!B2+LEN("[A1]")', 1, 2)).toBe(
      'SUM(C:$B,2:$2)+LOG10(C2)+\'A1\'!D3+LEN("[A1]")'
    )
  })
  it('can view caches for unsupported shared references while refusing unsafe unsharing', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml(
        '<row r="1"><c r="B1"><f t="shared" si="0" ref="B1:B2">SUM(SampleTable[Amount])</f><v>3</v></c></row><row r="2"><c r="B2"><f t="shared" si="0"/><v>4</v></c></row>'
      )
    )
    const book = await openXlsx(zipSync(parts))
    const sheet = await book.sheet('Sample')
    expect(sheet.cells.get('B2')?.value).toBe(4)
    await expect(
      applyWorkbookEdit(book, { sheet: 'Sample', range: 'B1', values: [[8]] })
    ).rejects.toThrow(/shared/i)
  })
  it('decodes Excel escaped text, preserves literal escape-looking strings and carriage returns on write', async () => {
    const parts = sampleParts()
    parts['xl/sharedStrings.xml'] = strToU8(
      strFromU8(parts['xl/sharedStrings.xml']).replace('heading', 'heading_x000A_tail')
    )
    const book = await openXlsx(zipSync(parts))
    expect((await book.sheet('Sample')).cells.get('A1')?.value).toBe('Sample heading\ntail')
    const value = '_x0041_ literal\rreturn'
    const after = await applyWorkbookEdit(book, {
      sheet: 'Sample',
      range: 'A2',
      values: [[{ value }]],
    })
    const source = strFromU8(unzipSync(after)['xl/worksheets/sheet1.xml'])
    expect(source).toContain('_x005F_x0041_')
    expect(source).toContain('_x000D_')
    expect((await (await openXlsx(after)).sheet('Sample')).cells.get('A2')?.value).toBe(value)
  })
  it('refuses value edits on dynamic cell metadata rather than retaining a stale metadata pointer', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml('<row r="1"><c r="B1" cm="1"><v>7</v></c></row>')
    )
    await expect(
      applyWorkbookEdit(await openXlsx(zipSync(parts)), {
        sheet: 'Sample',
        range: 'B1',
        values: [[9]],
      })
    ).rejects.toThrow(/metadata/i)
  })
  it('appends to self-closing style collections with correct counts and expands formatted dimensions', async () => {
    const parts = sampleParts()
    parts['xl/styles.xml'] = strToU8(
      strFromU8(parts['xl/styles.xml']).replace('<fonts count="2">', '<numFmts/><fonts count="2">')
    )
    const after = await applyWorkbookFormat(await openXlsx(zipSync(parts)), {
      sheet: 'Sample',
      range: 'D10',
      format: { number_format: '0.000000' },
    })
    const book = await openXlsx(after)
    expect(
      (await book.sheet('Sample')).tree.children.find((n) => n.local === 'dimension')?.attrs.ref
    ).toBe('A1:D10')
    const root = await parseXml(strFromU8(unzipSync(after)['xl/styles.xml']))
    expect(root.children.find((n) => n.local === 'numFmts')?.attrs.count).toBe('1')
  })
  it('creates a missing stylesheet and its relationship/type atomically without changing unrelated parts', async () => {
    const parts = sampleParts()
    delete parts['xl/styles.xml']
    parts['xl/_rels/workbook.xml.rels'] = strToU8(
      strFromU8(parts['xl/_rels/workbook.xml.rels']).replace(
        new RegExp(`<Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/>`),
        ''
      )
    )
    parts['xl/worksheets/sheet1.xml'] = strToU8(sheetXml('<row r="1"><c r="A1"><v>5</v></c></row>'))
    const before = zipSync(parts)
    const after = await applyWorkbookFormat(await openXlsx(before), {
      sheet: 'Sample',
      range: 'A1',
      format: { bold: true },
    })
    const book = await openXlsx(after)
    expect((await book.sheet('Sample')).cells.get('A1')?.style.bold).toBe(true)
    const output = unzipSync(after)
    expect(output[book.stylesPart!]).toBeDefined()
    expect(strFromU8(output['[Content_Types].xml'])).toContain('/' + book.stylesPart)
    for (const name of Object.keys(parts))
      if (
        !['xl/worksheets/sheet1.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml'].includes(
          name
        )
      )
        expect(output[name], name).toEqual(parts[name])
  })
  it('extends existing row span hints when inserting a new cell outside the span', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml('<row r="1" spans="1:2"><c r="A1"><v>5</v></c></row>')
    )
    const after = await applyWorkbookEdit(await openXlsx(zipSync(parts)), {
      sheet: 'Sample',
      range: 'D1',
      values: [[8]],
    })
    expect((await (await openXlsx(after)).sheet('Sample')).source).toContain('spans="1:4"')
  })
  it('refuses a saved XML part exceeding the same read limit instead of creating an unreadable workbook', async () => {
    const mutation = new PackageMutation(await openXlsx(sampleXlsx()))
    mutation.set('xl/worksheets/sheet1.xml', '<sample>' + 's'.repeat(MAX_XML) + '</sample>')
    const refused = await mutation.finish().then(
      () => false,
      (error) => /XML.*large/i.test(error.message)
    )
    expect(refused).toBe(true)
  })
  it('does not add a new part to an archive already at the shared part-count cap', async () => {
    const parts = sampleParts()
    for (let i = Object.keys(parts).length; i < 4000; i++)
      parts[`custom/sample-${i}.bin`] = new Uint8Array([0])
    const mutation = new PackageMutation(await openXlsx(zipSync(parts)))
    mutation.parts.set('custom/new.bin', new Uint8Array([1]))
    const refused = await mutation.finish().then(
      () => false,
      (error) => /too many|parts/i.test(error.message)
    )
    expect(refused).toBe(true)
  }, 30000)
  it('retains a no-op ZIP even through the calculation pipeline', async () => {
    const bytes = sampleXlsx()
    const calc = await applyCalculatedEdit(await openXlsx(bytes), {
      sheet: 'Sample',
      range: 'B2',
      values: [[20]],
    })
    expect(calc.bytes).toBe(bytes)
  })
})
