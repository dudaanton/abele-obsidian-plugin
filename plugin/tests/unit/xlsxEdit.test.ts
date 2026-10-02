import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookEdit } from '@/spreadsheet/edit'
import { sampleParts, sampleXlsx, sheetXml } from '../fixtures/xlsx/sampleXlsx'
import { parseXml } from '@/ooxml/xml'

describe('workbook patching', () => {
  it('keeps cell extension XML after the edited value in schema order', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml(
        '<row r="1"><c r="B1" custom="sample"><v>10</v><extLst><ext uri="sample"/></extLst></c></row>'
      )
    )
    const after = await applyWorkbookEdit(await openXlsx(zipSync(parts)), {
      sheet: 'Sample',
      range: 'B1',
      values: [[11]],
    })
    const source = strFromU8(unzipSync(after)['xl/worksheets/sheet1.xml'])
    expect(source.indexOf('>11</v>')).toBeLessThan(source.indexOf('<extLst>'))
    expect(source).toContain('custom="sample"')
    expect(source).toContain('<extLst><ext uri="sample"/></extLst>')
  })
  it('patches values/formulas, adds missing rows/cells in order and keeps unrelated parts byte-identical', async () => {
    const original = sampleXlsx()
    const book = await openXlsx(original)
    const after = await applyWorkbookEdit(book, {
      sheet: 'Sample',
      range: 'B2:C3',
      values: [
        [25, { formula: 'B2*2' }],
        [true, '<sample>'],
      ],
    })
    const reopened = await openXlsx(after)
    const sheet = await reopened.sheet('Sample')
    expect(sheet.cells.get('B2')?.value).toBe(25)
    expect(sheet.cells.get('C2')?.formula).toBe('B2*2')
    expect(sheet.cells.get('C2')?.value).toBe(null)
    expect(sheet.cells.get('B3')?.value).toBe(true)
    expect(sheet.cells.get('C3')?.value).toBe('<sample>')
    expect(reopened.stale).toBe(true)
    const beforeParts = unzipSync(original)
    const afterParts = unzipSync(after)
    for (const name of Object.keys(beforeParts))
      if (!['xl/worksheets/sheet1.xml', 'xl/workbook.xml'].includes(name))
        expect(afterParts[name], name).toEqual(beforeParts[name])
    const source = strFromU8(afterParts['xl/worksheets/sheet1.xml'])
    expect(source).toContain('<c r="B1"><v>10</v></c>')
    await parseXml(source)
  })
  it('retains exact original bytes for a no-op and invalidates calcChain with all references', async () => {
    const original = sampleXlsx()
    const book = await openXlsx(original)
    expect(await applyWorkbookEdit(book, { sheet: 'Sample', range: 'B2', values: [[20]] })).toBe(
      original
    )
    const parts = sampleParts()
    parts['xl/calcChain.xml'] = strToU8('<calcChain/>')
    parts['xl/_rels/workbook.xml.rels'] = strToU8(
      strFromU8(parts['xl/_rels/workbook.xml.rels']).replace(
        '</Relationships>',
        '<Relationship Id="chain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>'
      )
    )
    parts['[Content_Types].xml'] = strToU8(
      strFromU8(parts['[Content_Types].xml']).replace(
        '</Types>',
        '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>'
      )
    )
    const after = unzipSync(
      await applyWorkbookEdit(await openXlsx(zipSync(parts)), {
        sheet: 'Sample',
        range: 'B2',
        values: [[21]],
      })
    )
    expect(after['xl/calcChain.xml']).toBeUndefined()
    expect(strFromU8(after['xl/_rels/workbook.xml.rels'])).not.toContain('calcChain')
    expect(strFromU8(after['[Content_Types].xml'])).not.toContain('calcChain')
  })
  it('unshares the entire formula group before changing a follower, respecting relative/absolute references', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml(
        '<row r="1"><c r="B1"><f t="shared" si="3" ref="B1:B3">A1+$A$4+SUM($C1:D$4)+LEN("A1")</f><v>1</v></c></row><row r="2"><c r="B2"><f t="shared" si="3"/><v>2</v></c></row><row r="3"><c r="B3"><f t="shared" si="3"/><v>3</v></c></row>'
      )
    )
    const after = await applyWorkbookEdit(await openXlsx(zipSync(parts)), {
      sheet: 'Sample',
      range: 'B2',
      values: [[100]],
    })
    const sheet = await (await openXlsx(after)).sheet('Sample')
    expect(sheet.cells.get('B1')?.formula).toBe('A1+$A$4+SUM($C1:D$4)+LEN("A1")')
    expect(sheet.cells.get('B3')?.formula).toBe('A3+$A$4+SUM($C3:D$4)+LEN("A1")')
    expect(sheet.cells.get('B2')?.formula).toBeUndefined()
    expect(sheet.source).not.toContain('t="shared"')
  })
  it('refuses array interiors, merged followers, protected sheets, macros, invalid values and mismatched dimensions without writing', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml('<row r="1"><c r="A1"><f t="array" ref="A1:B2">ROW(A1:B2)</f><v>1</v></c></row>')
    )
    await expect(
      applyWorkbookEdit(await openXlsx(zipSync(parts)), {
        sheet: 'Sample',
        range: 'B2',
        values: [[7]],
      })
    ).rejects.toThrow(/array/i)
    await expect(
      applyWorkbookEdit(await openXlsx(sampleXlsx()), {
        sheet: 'Sample',
        range: 'B4',
        values: [[7]],
      })
    ).rejects.toThrow(/merged/i)
    await expect(
      applyWorkbookEdit(await openXlsx(sampleXlsx(), true), {
        sheet: 'Sample',
        range: 'B2',
        values: [[7]],
      })
    ).rejects.toThrow(/read-only/i)
    await expect(
      applyWorkbookEdit(await openXlsx(sampleXlsx()), {
        sheet: 'Sample',
        range: 'B2:C2',
        values: [[7]],
      })
    ).rejects.toThrow(/dimensions/i)
    await expect(
      applyWorkbookEdit(await openXlsx(sampleXlsx()), {
        sheet: 'Sample',
        range: 'B2',
        values: [['bad\u0000text']],
      })
    ).rejects.toThrow(/XML|characters/i)
  })
})
