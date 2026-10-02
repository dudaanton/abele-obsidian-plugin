import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookEdit } from '@/spreadsheet/edit'
import { applyWorkbookFormat } from '@/spreadsheet/format'
import { saveParts, resolvePart } from '@/ooxml/package'
import { parseXml, rawNode, REL } from '@/ooxml/xml'
import { featureWorkbook } from '../fixtures/xlsx/featureWorkbook'
async function assertPackage(bytes: Uint8Array) {
  const parts = unzipSync(bytes)
  for (const [name, data] of Object.entries(parts)) {
    if (!/\.(xml|rels)$/.test(name)) continue
    const source = strFromU8(data)
    const root = await parseXml(source)
    const dom = new DOMParser().parseFromString(source, 'application/xml')
    expect(dom.getElementsByTagName('parsererror').length, name).toBe(0)
    if (name.endsWith('.rels')) {
      const base = name === '_rels/.rels' ? '' : name.replace('/_rels/', '/').replace(/\.rels$/, '')
      expect(new Set(root.children.map((n) => n.attrs.Id)).size, name).toBe(root.children.length)
      for (const rel of root.children)
        if (rel.ns === REL && rel.attrs.TargetMode !== 'External')
          expect(
            parts[resolvePart(base, rel.attrs.Target)],
            `${name}: ${rel.attrs.Target}`
          ).toBeDefined()
    }
    if (name.endsWith('/styles.xml'))
      for (const n of root.children)
        if (n.attrs.count !== undefined)
          expect(Number(n.attrs.count), n.local).toBe(n.children.length)
  }
  const book = await openXlsx(bytes)
  for (const s of book.sheets) await book.sheet(s.name)
}
describe('workbook feature preservation', () => {
  it('returns exactly the original archive when opened/saved without an edit', async () => {
    const bytes = featureWorkbook()
    await assertPackage(bytes)
    expect(await saveParts(await openXlsx(bytes), new Map())).toBe(bytes)
  })
  it('a value edit changes only the targeted cell and calculation flags, preserving charts/pivots/comments/validation/conditional XML', async () => {
    const bytes = featureWorkbook()
    const book = await openXlsx(bytes)
    const beforeSheet = await book.sheet('Sample')
    const edited = await applyWorkbookEdit(book, { sheet: 'Sample', range: 'B2', values: [[25]] })
    await assertPackage(edited)
    const before = unzipSync(bytes)
    const after = unzipSync(edited)
    for (const name of Object.keys(before))
      if (!['xl/worksheets/sheet1.xml', 'xl/workbook.xml'].includes(name))
        expect(after[name], name).toEqual(before[name])
    const afterSheet = await (await openXlsx(edited)).sheet('Sample')
    expect(
      beforeSheet.source.replace(rawNode(beforeSheet.source, beforeSheet.cells.get('B2')!.node), '')
    ).toBe(
      afterSheet.source.replace(rawNode(afterSheet.source, afterSheet.cells.get('B2')!.node), '')
    )
    for (const marker of [
      'conditionalFormatting',
      'dataValidations',
      'drawing',
      'tableParts',
      'keep verbatim',
    ])
      expect(afterSheet.source).toContain(marker)
  })
  it('formatting appends styles while all chart/pivot/comment relationships and media stay byte-identical', async () => {
    const bytes = featureWorkbook()
    const formatted = await applyWorkbookFormat(await openXlsx(bytes), {
      sheet: 'Sample',
      range: 'B2',
      format: { bold: true, fill: '#99CCDD' },
    })
    await assertPackage(formatted)
    const before = unzipSync(bytes)
    const after = unzipSync(formatted)
    for (const name of Object.keys(before))
      if (!['xl/worksheets/sheet1.xml', 'xl/styles.xml'].includes(name))
        expect(after[name], name).toEqual(before[name])
  })
})
