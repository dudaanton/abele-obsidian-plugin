import { describe, expect, it } from 'vitest'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookEdit } from '@/spreadsheet/edit'
import { applyWorkbookFormat } from '@/spreadsheet/format'
import { parseXml, descendants } from '@/ooxml/xml'
import { sampleParts, S } from '../fixtures/xlsx/sampleXlsx'

describe('workbook namespace-preserving patches', () => {
  it('retains foreign cell extensions under a row-local binding when values and missing rows change', async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      `<s:worksheet xmlns:s="${S}" xmlns="urn:sample" xmlns:p="urn:outer"><s:sheetData><s:row r="1" xmlns:p="urn:inner"><s:c r="A1" t="inlineStr"><s:is><s:t>Sample text</s:t></s:is><s:extLst><p:sample p:flag="keep"/></s:extLst></s:c></s:row></s:sheetData></s:worksheet>`
    )
    const updated = await applyWorkbookEdit(await openXlsx(zipSync(parts)), {
      sheet: 'Sample',
      range: 'A1:A2',
      values: [['Changed'], ['Added']],
    })
    const book = await openXlsx(updated)
    const sheet = await book.sheet('Sample')
    expect(sheet.cells.get('A1')?.value).toBe('Changed')
    expect(sheet.cells.get('A2')?.value).toBe('Added')
    expect(descendants(sheet.tree, 'urn:inner', 'sample')).toHaveLength(1)
    expect(descendants(sheet.tree, 'urn:outer', 'sample')).toHaveLength(0)
    expect(sheet.source).toContain('<p:sample p:flag="keep"/>')
  })
  it('retains collection-local font and xf prefixes while appending styles under a foreign default namespace', async () => {
    const parts = sampleParts()
    parts['xl/styles.xml'] = strToU8(
      `<s:styleSheet xmlns:s="${S}" xmlns="urn:sample" xmlns:p="urn:outer"><s:fonts count="1" xmlns:f="${S}"><f:font><f:sz val="11"/><p:sample/></f:font></s:fonts><s:fills count="2"><s:fill/><s:fill/></s:fills><s:borders count="1"><s:border/></s:borders><s:cellXfs count="1" xmlns:x="${S}"><x:xf fontId="0" fillId="0" numFmtId="0" borderId="0"><p:sample/></x:xf></s:cellXfs></s:styleSheet>`
    )
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      `<s:worksheet xmlns:s="${S}"><s:sheetData><s:row r="1"><s:c r="A1"><s:v>5</s:v></s:c></s:row></s:sheetData></s:worksheet>`
    )
    const updated = await applyWorkbookFormat(await openXlsx(zipSync(parts)), {
      sheet: 'Sample',
      range: 'A1',
      format: { bold: true, fill: '#33AA77' },
    })
    const book = await openXlsx(updated)
    expect((await book.sheet('Sample')).cells.get('A1')?.style).toMatchObject({
      bold: true,
      fill: '#33AA77',
    })
    const source = strFromU8(unzipSync(updated)['xl/styles.xml'])
    const tree = await parseXml(source)
    expect(descendants(tree, 'urn:outer', 'sample')).toHaveLength(4)
    expect(descendants(tree, 'urn:sample', 'sample')).toHaveLength(0)
    expect(source).toContain('<f:font><f:sz val="11"/><p:sample/></f:font>')
  })
})
