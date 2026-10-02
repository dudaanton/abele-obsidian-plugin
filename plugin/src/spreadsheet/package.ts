/** Lazy OOXML workbook model over bytes. No vault, DOM or spreadsheet application dependency. */
import { openOfficeArchive, resolvePart, xmlPart, type OfficePackage } from '@/ooxml/package'
import { attr, decodeXmlContent, descendants, parseXml, R, REL, type XmlNode } from '@/ooxml/xml'
import { cellAddress, parseCell, parseRange, translateFormula, type CellRange } from './address'
import { defaultStyle, readStyles, S, sc, type CellStyle, type CellValue } from './styles'
import { decodeSpreadsheetText } from './text'
import { contains } from './address'
export interface SheetInfo {
  name: string
  part: string
  id: string
  hidden: boolean
}
export interface WorkbookCell {
  address: string
  row: number
  column: number
  value: CellValue
  formula?: string
  formulaProblem?: string
  style: CellStyle
  styleId: number
  node: XmlNode
}
export interface WorkbookSheet extends SheetInfo {
  source: string
  tree: XmlNode
  cells: Map<string, WorkbookCell>
  maxRow: number
  maxColumn: number
  merges: CellRange[]
  columnWidths: Map<number, number>
  frozenRows: number
  protected: boolean
}
export interface Workbook extends OfficePackage {
  calculationNote?: string
  workbookPart: string
  workbookSource: string
  workbookTree: XmlNode
  relsPart: string
  sheets: SheetInfo[]
  stylesPart?: string
  stylesSource?: string
  stylesTree?: XmlNode
  styles: CellStyle[]
  strings: string[]
  date1904: boolean
  stale: boolean
  readOnly: boolean
  loaded: Map<string, WorkbookSheet>
  sheet(name: string): Promise<WorkbookSheet>
}
export const valueText = (source: string, node?: XmlNode) =>
  node ? decodeXmlContent(source.slice(node.openEnd, node.closeStart)) : ''
const richText = (source: string, node: XmlNode) =>
  descendants(node, S, 't')
    .filter((n) => n.parent?.local !== 'rPh')
    .map((n) => decodeSpreadsheetText(valueText(source, n)))
    .join('')
export async function openXlsx(
  original: Uint8Array,
  readOnly = false,
  yieldTask?: () => Promise<void>
): Promise<Workbook> {
  const archive = await openOfficeArchive(original, yieldTask)
  const tree = async (part: string) => {
    const source = xmlPart(archive, part)
    if (source === null) throw new Error(`Missing workbook part ${part}`)
    return { source, root: await parseXml(source, yieldTask) }
  }
  const rootRels = await tree('_rels/.rels')
  const office = rootRels.root.children.find(
    (n) =>
      n.ns === REL && n.attrs.Type === R + '/officeDocument' && n.attrs.TargetMode !== 'External'
  )
  if (!office) throw new Error('No workbook relationship')
  const workbookPart = resolvePart('', office.attrs.Target)
  const main = await tree(workbookPart)
  if (main.root.ns !== S || main.root.local !== 'workbook')
    throw new Error('Not a supported Excel workbook')
  const segments = workbookPart.split('/')
  const filename = segments.pop()
  const relsPart = [...segments, '_rels', filename + '.rels'].join('/')
  const rels = await tree(relsPart)
  const relations = new Map(
    rels.root.children.filter((n) => n.ns === REL).map((n) => [n.attrs.Id, n])
  )
  const relationPart = (rel: XmlNode) => {
    if (rel.attrs.TargetMode === 'External')
      throw new Error('External workbook parts are not supported')
    return resolvePart(workbookPart, rel.attrs.Target)
  }
  const sheets: SheetInfo[] = (sc(main.root, 'sheets')?.children ?? [])
    .filter((n) => n.ns === S && n.local === 'sheet')
    .map((n) => {
      const rel = relations.get(attr(n, 'id', R) ?? '')
      if (!rel || rel.attrs.Type !== R + '/worksheet')
        throw new Error('Unsupported sheet relationship')
      return {
        name: n.attrs.name,
        id: n.attrs.sheetId,
        part: relationPart(rel),
        hidden: ['hidden', 'veryHidden'].includes(n.attrs.state),
      }
    })
  if (
    !sheets.length ||
    sheets.length > 256 ||
    new Set(sheets.map((s) => s.name)).size !== sheets.length ||
    new Set(sheets.map((s) => s.part)).size !== sheets.length
  )
    throw new Error('Invalid or too many sheets (256 limit)')
  const stylesRel = [...relations.values()].find((n) => n.attrs.Type === R + '/styles')
  const stylesPart = stylesRel ? relationPart(stylesRel) : undefined
  const styleData = stylesPart ? await tree(stylesPart) : undefined
  const stringsRel = [...relations.values()].find((n) => n.attrs.Type === R + '/sharedStrings')
  const stringsData = stringsRel ? await tree(relationPart(stringsRel)) : undefined
  const strings = stringsData
    ? stringsData.root.children
        .filter((n) => n.ns === S && n.local === 'si')
        .map((n) => richText(stringsData.source, n))
    : []
  const loaded = new Map<string, WorkbookSheet>()
  const book: Workbook = {
    original,
    archive,
    workbookPart,
    workbookSource: main.source,
    workbookTree: main.root,
    relsPart,
    sheets,
    stylesPart,
    stylesSource: styleData?.source,
    stylesTree: styleData?.root,
    styles: readStyles(styleData?.root),
    strings,
    date1904: ['1', 'true'].includes(sc(main.root, 'workbookPr')?.attrs.date1904 ?? ''),
    stale: ['1', 'true'].includes(sc(main.root, 'calcPr')?.attrs.fullCalcOnLoad ?? ''),
    readOnly: readOnly || archive.entries.some((e) => /vbaProject\.bin$/i.test(e.filename)),
    loaded,
    async sheet(name) {
      const cached = loaded.get(name)
      if (cached) return cached
      const info = sheets.find((s) => s.name === name)
      if (!info) throw new Error('Sheet not found; use its exact name')
      const data = await tree(info.part)
      if (data.root.ns !== S || data.root.local !== 'worksheet')
        throw new Error('Invalid worksheet')
      const cells = new Map<string, WorkbookCell>()
      let maxRow = 1
      let maxColumn = 1
      const sheetData = sc(data.root, 'sheetData')
      let previousRow = 0
      for (const row of sheetData?.children ?? []) {
        if (row.ns !== S || row.local !== 'row') continue
        const number = Number(row.attrs.r)
        if (
          !/^[1-9]\d{0,6}$/.test(row.attrs.r ?? '') ||
          !Number.isInteger(number) ||
          number <= previousRow
        )
          throw new Error('Invalid, duplicate or out-of-order worksheet row')
        cellAddress(number, 1)
        maxRow = Math.max(maxRow, number)
        previousRow = number
      }
      const nodes = descendants(sheetData ?? data.root, S, 'c')
      if (nodes.length > 200000) throw new Error('Sheet is too large (200000 stored cells limit)')
      const shared = new Map<
        string,
        { formula: string; row: number; column: number; ref?: CellRange; problem?: string }
      >()
      for (const n of nodes) {
        const f = sc(n, 'f')
        if (f?.attrs.t !== 'shared' || !valueText(data.source, f)) continue
        const base = {
          formula: valueText(data.source, f),
          ...parseCell(n.attrs.r),
          ref: undefined as CellRange | undefined,
          problem: undefined as string | undefined,
        }
        try {
          if (shared.has(f.attrs.si) || !f.attrs.ref || !/^\d+$/.test(f.attrs.si))
            throw new Error('Invalid shared formula group')
          base.ref = parseRange(f.attrs.ref)
          translateFormula(base.formula, 0, 0)
        } catch (e) {
          base.problem = (e as Error).message
        }
        shared.set(f.attrs.si, base)
      }
      for (const n of nodes) {
        const pos = parseCell(n.attrs.r)
        const address = cellAddress(pos.row, pos.column)
        if (cells.has(address) || n.parent?.attrs.r !== String(pos.row))
          throw new Error('Invalid or duplicate worksheet cell')
        maxRow = Math.max(maxRow, pos.row)
        maxColumn = Math.max(maxColumn, pos.column)
        const f = sc(n, 'f')
        let formula = f ? valueText(data.source, f) : undefined
        let formulaProblem: string | undefined
        if (f?.attrs.t === 'shared') {
          const base = shared.get(f.attrs.si)
          formulaProblem = !base ? 'Missing shared formula anchor' : base.problem
          if (base?.ref && !contains(base.ref, pos))
            formulaProblem = 'Cell outside shared formula range'
          if (!formula && base && !formulaProblem) {
            try {
              formula = translateFormula(base.formula, pos.row - base.row, pos.column - base.column)
            } catch (e) {
              formulaProblem = (e as Error).message
            }
          }
          if (!formula) formula = undefined
        }
        const v = sc(n, 'v')
        const raw = valueText(data.source, v)
        let value: CellValue = !v ? null : n.attrs.t === 'str' ? decodeSpreadsheetText(raw) : raw
        if (n.attrs.t === 'inlineStr') value = sc(n, 'is') ? richText(data.source, sc(n, 'is')) : ''
        else if (n.attrs.t === 's') {
          if (!/^\d+$/.test(raw) || strings[Number(raw)] === undefined)
            throw new Error('Invalid shared string')
          value = strings[Number(raw)]
        } else if (n.attrs.t === 'b') value = raw === '1'
        else if (!n.attrs.t || n.attrs.t === 'n')
          value = v && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null
        const styleId = Number(n.attrs.s ?? 0)
        cells.set(address, {
          address,
          ...pos,
          value,
          formula,
          formulaProblem,
          styleId,
          style: book.styles[styleId] ?? defaultStyle,
          node: n,
        })
      }
      for (const cell of cells.values()) {
        const ref = sc(cell.node, 'f')?.attrs.ref
        if (ref) {
          const range = parseRange(ref)
          maxRow = Math.max(maxRow, range.to.row)
          maxColumn = Math.max(maxColumn, range.to.column)
        }
      }
      const dimension = sc(data.root, 'dimension')?.attrs.ref
      if (dimension) {
        const range = parseRange(dimension)
        maxRow = Math.max(maxRow, range.to.row)
        maxColumn = Math.max(maxColumn, range.to.column)
      }
      const merges = (sc(data.root, 'mergeCells')?.children ?? []).map((n) =>
        parseRange(n.attrs.ref)
      )
      if (merges.length > 10000) throw new Error('Too many merged ranges')
      for (const range of merges) {
        maxRow = Math.max(maxRow, range.to.row)
        maxColumn = Math.max(maxColumn, range.to.column)
      }
      const columnWidths = new Map<number, number>()
      for (const col of sc(data.root, 'cols')?.children ?? []) {
        const min = Number(col.attrs.min)
        const max = Number(col.attrs.max)
        if (min < 1 || max > 16384 || !Number.isInteger(min) || !Number.isInteger(max))
          throw new Error('Invalid column widths')
        for (let c = min; c <= max; c++)
          columnWidths.set(
            c,
            col.attrs.hidden === '1'
              ? 0
              : Math.min(600, Math.max(24, Number(col.attrs.width || 12) * 7 + 5))
          )
      }
      const pane = descendants(data.root, S, 'pane')[0]
      const frozenRows =
        pane && ['frozen', 'frozenSplit'].includes(pane.attrs.state)
          ? Math.min(maxRow, Math.max(0, Number(pane.attrs.ySplit || 0)))
          : 0
      const sheet: WorkbookSheet = {
        ...info,
        source: data.source,
        tree: data.root,
        cells,
        maxRow,
        maxColumn,
        merges,
        columnWidths,
        frozenRows,
        protected: !!sc(data.root, 'sheetProtection'),
      }
      // One indexed sheet at a time on phones; callers retaining a sheet still own that object.
      loaded.clear()
      loaded.set(name, sheet)
      return sheet
    },
  }
  return book
}
