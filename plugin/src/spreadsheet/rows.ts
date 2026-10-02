import { PackageMutation, nodeWithContent, setAttributes } from '@/ooxml/mutation'
import { parseXml, patchXml, R } from '@/ooxml/xml'
import { xmlPart } from '@/ooxml/package'
import { MAX_ROWS, cellAddress } from './address'
import { assertEditable, expandDimension, invalidateCalculation, sTag } from './edit'
import type { Workbook } from './package'
import { S, sc } from './styles'
export interface RowEdit {
  operation: 'row_add' | 'row_delete'
  sheet: string
  rows?: number
}
export function rowCount(value: unknown): number {
  const count = value === undefined ? 1 : Number(value)
  if (!Number.isInteger(count) || count < 1 || count > 1000)
    throw new Error('Row count must be 1–1000')
  return count
}
/** No middle insertion/deletion: existing addresses and unknown graph references never shift. */
export async function applyWorkbookRows(book: Workbook, edit: RowEdit): Promise<Uint8Array> {
  const count = rowCount(edit.rows)
  const sheet = await book.sheet(edit.sheet)
  assertEditable(book, sheet, [])
  const data = sc(sheet.tree, 'sheetData')
  if (!data) throw new Error('Missing worksheet data')
  let source = sheet.source
  if (edit.operation === 'row_add') {
    if (sheet.maxRow + count > MAX_ROWS) throw new Error('Worksheet row limit exceeded')
    const fragment = Array.from({ length: count }, (_, i) =>
      sTag('row', '', `r="${sheet.maxRow + i + 1}"`)
    ).join('')
    source = patchXml(source, [
      {
        start: data.start,
        end: data.end,
        text: nodeWithContent(source, data, source.slice(data.openEnd, data.closeStart) + fragment),
      },
    ])
    source = await expandDimension(source, sheet.maxRow + count, sheet.maxColumn)
  } else if (edit.operation === 'row_delete') {
    if (sheet.maxRow - count < 1) throw new Error('Keep at least one row; invalid row count')
    const from = sheet.maxRow - count + 1
    const relationships = await parseXml(xmlPart(book.archive, book.relsPart))
    const unknownRelation = relationships.children.some(
      (n) => ![R + '/worksheet', R + '/styles', R + '/sharedStrings'].includes(n.attrs.Type)
    )
    const sheetRelations = book.sheets.some((info) => {
      const parts = info.part.split('/')
      const name = parts.pop()
      return book.archive.entries.some(
        (e) => e.filename === [...parts, '_rels', name + '.rels'].join('/')
      )
    })
    if (unknownRelation || sheetRelations)
      throw new Error(
        'Trailing row deletion needs structural reference rewriting; use a spreadsheet app'
      )
    const permitted = new Set([
      'sheetPr',
      'dimension',
      'sheetViews',
      'sheetFormatPr',
      'cols',
      'sheetData',
      'printOptions',
      'pageMargins',
      'pageSetup',
      'headerFooter',
    ])
    if (
      sheet.tree.children.some((n) => n.ns !== S || !permitted.has(n.local)) ||
      book.archive.entries.some((e) =>
        /^xl\/(?:drawings|charts|tables|pivotTables|pivotCache|externalLinks|comments)/.test(
          e.filename
        )
      ) ||
      sc(book.workbookTree, 'definedNames')
    )
      throw new Error(
        'Trailing row deletion needs structural reference rewriting; use a spreadsheet app'
      )
    for (const info of book.sheets) {
      const other = await book.sheet(info.name)
      if (
        [...other.cells.values()].some(
          (c) =>
            c.formula !== undefined ||
            c.formulaProblem ||
            c.node.attrs.cm !== undefined ||
            c.node.attrs.vm !== undefined
        )
      )
        throw new Error('Trailing row deletion with formulas/metadata requires a spreadsheet app')
    }
    if ([...sheet.cells.values()].filter((c) => c.row >= from).length > 1000)
      throw new Error('Row deletion exceeds the 1000-cell change limit')
    const rows = data.children.filter(
      (n) => n.ns === S && n.local === 'row' && Number(n.attrs.r) >= from
    )
    source = patchXml(
      source,
      rows.map((n) => ({ start: n.start, end: n.end, text: '' }))
    )
    const root = await parseXml(source)
    const dim = sc(root, 'dimension')
    if (dim)
      source = patchXml(source, [
        {
          start: dim.start,
          end: dim.end,
          text: setAttributes(source, dim, { ref: `A1:${cellAddress(from - 1, sheet.maxColumn)}` }),
        },
      ])
    else source = await expandDimension(source, from - 1, sheet.maxColumn)
  } else throw new Error('Unknown row operation')
  const mutation = new PackageMutation(book)
  mutation.set(sheet.part, source)
  await invalidateCalculation(book, mutation)
  return mutation.finish()
}
