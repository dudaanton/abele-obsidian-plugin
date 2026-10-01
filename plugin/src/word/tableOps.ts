import type { WordEdit } from './edit'
import type { WordTable } from './package'
import { WordMutation } from './mutation'
import {
  assertPlain,
  newParagraphWith,
  nodeWithContent,
  propertiesNode,
  textRun,
  wTag,
} from './structure'
import {
  attr,
  child,
  descendants,
  isW,
  patchXml,
  rawNode,
  W,
  type Patch,
  type XmlNode,
} from './xml'

interface Cell {
  node: XmlNode
  column: number
  span: number
  merge?: string
}
interface Grid {
  table: WordTable
  rows: Cell[][]
  widths: number[]
  columns: number
}
export function tableGrid(m: WordMutation, number: number): Grid {
  const table = m.doc.tables[number - 1]
  if (!table || !Number.isInteger(number)) throw new Error('No such table')
  if (descendants(table.node, W, 'tbl').length !== 1) throw new Error('Nested tables are read-only')
  const grid = child(table.node, 'tblGrid')
  const widths =
    grid?.children
      .filter((n) => isW(n, 'gridCol'))
      .map((n) => Math.max(1, Number(attr(n, 'w')) || 2000)) ?? []
  if (!widths.length || widths.length > 100) throw new Error('Unsupported table grid is read-only')
  const rows = table.rows.map((tr) => {
    if (
      tr.children.some((n) => n.ns !== W || !['tc', 'trPr'].includes(n.local)) ||
      descendants(tr).some((n) =>
        ['trPrChange', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange', 'hMerge'].includes(n.local)
      )
    )
      throw new Error('Protected table structure is read-only')
    const rowProps = child(tr, 'trPr')
    if (rowProps && (child(rowProps, 'gridBefore') || child(rowProps, 'gridAfter')))
      throw new Error('Offset table grids are read-only')
    let column = 1
    const cells = tr.children
      .filter((n) => isW(n, 'tc'))
      .map((node) => {
        if (node.children.some((n) => n.ns !== W || !['tcPr', 'p'].includes(n.local)))
          throw new Error('Unsupported cell structure is read-only')
        for (const p of m.doc.paragraphs.filter((p) => p.node.parent === node)) assertPlain(p)
        const props = child(node, 'tcPr')
        const span = Number(attr(props && child(props, 'gridSpan'), 'val') || 1)
        if (!Number.isInteger(span) || span < 1) throw new Error('Invalid cell span')
        const mergeNode = props && child(props, 'vMerge')
        const cell: Cell = {
          node,
          column,
          span,
          merge: mergeNode ? (attr(mergeNode, 'val') ?? 'continue') : undefined,
        }
        column += span
        return cell
      })
    if (column !== widths.length + 1) throw new Error('Nonrectangular table grid is read-only')
    return cells
  })
  return { table, rows, widths, columns: widths.length }
}
const cellAt = (grid: Grid, row: number, column: number): Cell => {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || column < 1)
    throw new Error('Rows and grid columns start at 1')
  const cell = grid.rows[row - 1]?.find((c) => column >= c.column && column < c.column + c.span)
  if (!cell) throw new Error('No cell at that row and grid column')
  return cell
}
function cellContents(source: string, node: XmlNode): string {
  return node.children
    .filter((n) => !isW(n, 'tcPr'))
    .map((n) => rawNode(source, n))
    .join('')
}
function adjustedCell(
  source: string,
  node: XmlNode,
  span: number,
  width: number,
  merge: string | undefined,
  content?: string
): string {
  let raw = propertiesNode(source, node, 'tcPr', {
    tcW: wTag('tcW', '', `w:w="${width}" w:type="dxa"`),
    gridSpan: span > 1 ? wTag('gridSpan', '', `w:val="${span}"`) : null,
    vMerge: merge ? wTag('vMerge', '', `w:val="${merge}"`) : null,
  })
  if (content === undefined) return raw
  // tcPr is the first child in valid Word cells. Keep the changed property block verbatim.
  // Find the closing property using its original QName too; no other content is serialized.
  const props = child(node, 'tcPr')
  const name = props?.name ?? 'w:tcPr'
  const openEnd = raw.indexOf('>') + 1
  const pattern = new RegExp(`<${name}(?:\\s[^>]*?)?(?:/>|>[\\s\\S]*?</${name}>)`)
  const property = raw.slice(openEnd).match(pattern)?.[0] ?? ''
  const opening = raw.slice(0, openEnd)
  raw = opening + property + content + `</${node.name}>`
  return raw
}
export function tableOperation(m: WordMutation, e: WordEdit): Patch[] {
  const p = m.doc.paragraphs[e.paragraph - 1]
  const grid = tableGrid(m, e.table ?? p?.table ?? 0)
  const source = m.doc.xml.get('word/document.xml')!
  const row = e.row ?? p?.row ?? 1
  const column = e.column ?? p?.cell ?? 1
  const first = cellAt(grid, row, column)
  if (e.operation === 'row_add' || e.operation === 'row_delete') {
    if (grid.rows.some((r) => r.some((c) => c.merge)))
      throw new Error('Row edits crossing vertical merges are read-only; split the cells first')
    const tr = grid.table.rows[row - 1]
    if (e.operation === 'row_delete') {
      if (grid.rows.length <= 1) throw new Error('Keep at least one table row')
      return [{ start: tr.start, end: tr.end, text: '' }]
    }
    const properties = child(tr, 'trPr')
    const cells = grid.rows[row - 1]
      .map((c) => {
        const props = child(c.node, 'tcPr')
        const firstParagraph = m.doc.paragraphs.find((p) => p.node.parent === c.node)
        return nodeWithContent(
          source,
          c.node,
          (props ? rawNode(source, props) : '') +
            (firstParagraph
              ? newParagraphWith(m.doc, firstParagraph, textRun(''))
              : wTag('p', textRun('')))
        )
      })
      .join('')
    return [
      {
        start: tr.end,
        end: tr.end,
        text: nodeWithContent(source, tr, (properties ? rawNode(source, properties) : '') + cells),
      },
    ]
  }
  if (e.operation === 'cells_merge') {
    const lastRow = e.to_row ?? row
    const lastColumn = e.to_column ?? column
    if (
      !Number.isInteger(lastRow) ||
      !Number.isInteger(lastColumn) ||
      lastRow < row ||
      lastColumn < column ||
      lastRow > grid.rows.length ||
      lastColumn > grid.columns ||
      (lastRow === row && lastColumn === column)
    )
      throw new Error('Choose a nonempty cell rectangle')
    const selected: Cell[][] = []
    for (let r = row; r <= lastRow; r++) {
      const cells = grid.rows[r - 1].filter((c) => c.column >= column && c.column <= lastColumn)
      if (
        !cells.length ||
        cells[0].column !== column ||
        cells.at(-1)!.column + cells.at(-1)!.span - 1 !== lastColumn ||
        cells.some((c) => c.merge)
      )
        throw new Error(
          'Rectangle must follow whole unmerged cell boundaries; split existing merges first'
        )
      selected.push(cells)
    }
    const content = selected
      .flat()
      .map((c) => cellContents(source, c.node))
      .join('')
    const span = lastColumn - column + 1
    const width = grid.widths.slice(column - 1, lastColumn).reduce((a, b) => a + b, 0)
    return selected.map((cells, i) => ({
      start: cells[0].node.start,
      end: cells.at(-1)!.node.end,
      text: adjustedCell(
        source,
        cells[0].node,
        span,
        width,
        lastRow > row ? (i === 0 ? 'restart' : 'continue') : undefined,
        i === 0 ? content : wTag('p', textRun(''))
      ),
    }))
  }
  if (e.operation === 'cells_split') {
    if (column !== first.column) throw new Error('Choose the first grid column of the merged cell')
    let top = row
    if (first.merge === 'continue') {
      while (top > 1 && cellAt(grid, top, column).merge === 'continue') top--
      if (cellAt(grid, top, column).merge !== 'restart') throw new Error('Invalid vertical merge')
    }
    const origin = cellAt(grid, top, column)
    const rows: number[] = [top]
    if (origin.merge === 'restart') {
      for (let r = top + 1; r <= grid.rows.length; r++) {
        const c = cellAt(grid, r, column)
        if (c.merge !== 'continue') break
        if (c.column !== column || c.span !== origin.span)
          throw new Error('Irregular vertical merge is read-only')
        rows.push(r)
      }
    }
    if (origin.span === 1 && !origin.merge) throw new Error('That cell is not merged')
    return rows.map((r) => {
      const c = cellAt(grid, r, column)
      const cells = Array.from({ length: c.span }, (_, i) =>
        adjustedCell(
          source,
          c.node,
          1,
          grid.widths[column - 1 + i],
          undefined,
          i === 0 ? cellContents(source, c.node) : wTag('p', textRun(''))
        )
      ).join('')
      return { start: c.node.start, end: c.node.end, text: cells }
    })
  }
  throw new Error('Unknown table operation')
}
