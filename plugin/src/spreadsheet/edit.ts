import { PackageMutation, nodeWithContent, setAttributes } from '@/ooxml/mutation'
import { resolvePart } from '@/ooxml/package'
import {
  escapeXml,
  parseXml,
  patchXml,
  rawNode,
  R,
  REL,
  type Patch,
  type XmlNode,
} from '@/ooxml/xml'
import { cellAddress, contains, parseCell, parseRange } from './address'
import { S, sc, type CellValue } from './styles'
import { valueText, type Workbook, type WorkbookSheet } from './package'
export type CellInput = CellValue | { formula: string } | { value: CellValue }
export interface WorkbookEdit {
  operation?: 'cells' | 'recalculate'
  sheet: string
  range: string
  values: CellInput[][]
}
export const sTag = (name: string, content = '', attrs = '') =>
  `<${name} xmlns="${S}"${attrs ? ' ' + attrs : ''}>${content}</${name}>`
export function validText(text: string): void {
  if (
    text.length > 32767 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      text
    )
  )
    throw new Error('Unsupported XML characters or cell text length (32767 limit)')
}
interface NormalCell {
  value: CellValue
  formula?: string
}
export function normalizeInput(input: CellInput): NormalCell {
  if (input && typeof input === 'object') {
    if ('formula' in input) {
      if (typeof input.formula !== 'string' || !input.formula.replace(/^=/, '').trim())
        throw new Error('Formula must not be empty')
      validText(input.formula)
      return { value: null, formula: input.formula.replace(/^=/, '') }
    }
    if ('value' in input) return normalizeLiteral(input.value)
    throw new Error('Invalid cell value')
  }
  if (typeof input === 'string' && input.startsWith('='))
    return normalizeInput({ formula: input.slice(1) })
  return normalizeLiteral(input as CellValue)
}
function normalizeLiteral(value: CellValue): NormalCell {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
    throw new Error('Invalid cell value')
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Cell number must be finite')
  if (typeof value === 'string') validText(value)
  return { value }
}
export function cellXml(
  sheet: WorkbookSheet,
  address: string,
  input: NormalCell,
  styleId?: number
): string {
  const existing = sheet.cells.get(address)
  const node = existing?.node
  const type =
    input.formula !== undefined
      ? null
      : typeof input.value === 'string'
        ? 'inlineStr'
        : typeof input.value === 'boolean'
          ? 'b'
          : null
  let content =
    input.formula !== undefined
      ? sTag('f', escapeXml(input.formula))
      : typeof input.value === 'string'
        ? sTag('is', `<t xml:space="preserve">${escapeXml(input.value)}</t>`)
        : input.value === null
          ? ''
          : sTag(
              'v',
              typeof input.value === 'boolean' ? (input.value ? '1' : '0') : String(input.value)
            )
  if (!node)
    return sTag(
      'c',
      content,
      `r="${address}"${type ? ' t="' + type + '"' : ''}${styleId !== undefined ? ' s="' + styleId + '"' : ''}`
    )
  // Cell metadata/extension nodes survive. Only f/v/is and the type attribute are replaced.
  const patches: Patch[] = node.children
    .filter((n) => n.ns === S && ['f', 'v', 'is'].includes(n.local))
    .map((n) => ({ start: n.start - node.start, end: n.end - node.start, text: '' }))
  let raw = patchXml(rawNode(sheet.source, node), patches)
  const parsedNode = { ...node, start: 0, openEnd: node.openEnd - node.start, end: raw.length }
  const rest = raw.slice(parsedNode.openEnd)
  raw = setAttributes(raw, parsedNode, {
    t: type,
    ...(styleId !== undefined ? { s: String(styleId) } : {}),
  })
  if (node.openEnd !== node.end) {
    const openLength = raw.length - rest.length
    raw = raw.slice(0, openLength) + content + rest
  } else raw = raw.replace(/\/\s*>$/, '>') + content + `</${node.name}>`
  return raw
}
/** Cell-level patches and sorted insertion without serializing any unrelated XML. */
export function patchCells(sheet: WorkbookSheet, changes: Map<string, string>): string {
  const data = sc(sheet.tree, 'sheetData')
  if (!data) throw new Error('Missing worksheet data')
  const patches: Patch[] = []
  const missing = new Map<number, Map<number, string>>()
  for (const [address, text] of changes) {
    const cell = sheet.cells.get(address)
    if (cell) patches.push({ start: cell.node.start, end: cell.node.end, text })
    else {
      const pos = parseCell(address)
      const row = missing.get(pos.row) ?? new Map<number, string>()
      row.set(pos.column, text)
      missing.set(pos.row, row)
    }
  }
  const rows = data.children.filter((n) => n.ns === S && n.local === 'row')
  const inserts = new Map<number, string[]>()
  const add = (at: number, text: string) => {
    const list = inserts.get(at) ?? []
    list.push(text)
    inserts.set(at, list)
  }
  for (const [r, cells] of [...missing].sort((a, b) => a[0] - b[0])) {
    const row = rows.find((n) => Number(n.attrs.r) === r)
    const ordered = [...cells].sort((a, b) => a[0] - b[0])
    if (!row) {
      const fragment = sTag('row', ordered.map(([, s]) => s).join(''), `r="${r}"`)
      const next = rows.find((n) => Number(n.attrs.r) > r)
      add(next?.start ?? data.closeStart, fragment)
    } else if (row.openEnd === row.end) {
      patches.push({
        start: row.start,
        end: row.end,
        text: nodeWithContent(sheet.source, row, ordered.map(([, s]) => s).join('')),
      })
    } else
      for (const [c, text] of ordered) {
        const next = row.children.find(
          (n) => n.ns === S && n.local === 'c' && parseCell(n.attrs.r).column > c
        )
        add(next?.start ?? row.closeStart, text)
      }
  }
  if (data.openEnd === data.end && inserts.size) {
    patches.push({
      start: data.start,
      end: data.end,
      text: nodeWithContent(sheet.source, data, [...inserts.values()].flat().join('')),
    })
  } else for (const [at, list] of inserts) patches.push({ start: at, end: at, text: list.join('') })
  return patchXml(sheet.source, patches)
}
export function assertEditable(book: Workbook, sheet: WorkbookSheet, addresses: string[]): void {
  if (book.readOnly) throw new Error('This workbook is read-only (.xlsm/macros)')
  if (sheet.protected || sc(book.workbookTree, 'workbookProtection'))
    throw new Error('Protected workbook/sheet is read-only')
  const positions = addresses.map(parseCell)
  for (const merge of sheet.merges)
    for (const pos of positions)
      if (contains(merge, pos) && (pos.row !== merge.from.row || pos.column !== merge.from.column))
        throw new Error('Edit the merged cell anchor, not a merged follower')
  for (const cell of sheet.cells.values()) {
    const f = sc(cell.node, 'f')
    if (f && f.attrs.t && !['normal', 'shared'].includes(f.attrs.t)) {
      const range = parseRange(f.attrs.ref ?? cell.address)
      if (positions.some((pos) => contains(range, pos)))
        throw new Error(
          'Array/data-table formula ranges are read-only; edit them in a spreadsheet app'
        )
    }
  }
}
export async function invalidateCalculation(
  book: Workbook,
  mutation: PackageMutation
): Promise<void> {
  const source = mutation.source(book.workbookPart)
  const root = await parseXml(source)
  const calc = sc(root, 'calcPr')
  if (calc)
    mutation.set(
      book.workbookPart,
      patchXml(source, [
        {
          start: calc.start,
          end: calc.end,
          text: setAttributes(source, calc, { fullCalcOnLoad: '1', forceFullCalc: '1' }),
        },
      ])
    )
  else {
    // calcPr precedes later workbook extension containers.
    const next = root.children.find((n) =>
      [
        'oleSize',
        'customWorkbookViews',
        'pivotCaches',
        'smartTagPr',
        'smartTagTypes',
        'webPublishing',
        'fileRecoveryPr',
        'webPublishObjects',
        'extLst',
      ].includes(n.local)
    )
    mutation.set(
      book.workbookPart,
      patchXml(source, [
        {
          start: next?.start ?? root.closeStart,
          end: next?.start ?? root.closeStart,
          text: sTag('calcPr', '', 'fullCalcOnLoad="1" forceFullCalc="1"'),
        },
      ])
    )
  }
  const relSource = mutation.source(book.relsPart)
  const rels = await parseXml(relSource)
  const chains = rels.children.filter((n) => n.ns === REL && n.attrs.Type === R + '/calcChain')
  const removed = new Set(chains.map((n) => resolvePart(book.workbookPart, n.attrs.Target)))
  if (book.archive.loadBytes('xl/calcChain.xml')) removed.add('xl/calcChain.xml')
  if (chains.length)
    mutation.set(
      book.relsPart,
      patchXml(
        relSource,
        chains.map((n) => ({ start: n.start, end: n.end, text: '' }))
      )
    )
  for (const name of removed) mutation.parts.set(name, null)
  if (removed.size) {
    const typeSource = mutation.source('[Content_Types].xml')
    const types = await parseXml(typeSource)
    mutation.set(
      '[Content_Types].xml',
      patchXml(
        typeSource,
        types.children
          .filter((n) => removed.has(n.attrs.PartName?.replace(/^\//, '')))
          .map((n) => ({ start: n.start, end: n.end, text: '' }))
      )
    )
  }
}
export async function applyWorkbookEdit(book: Workbook, edit: WorkbookEdit): Promise<Uint8Array> {
  const range = parseRange(edit.range, 1000)
  const height = range.to.row - range.from.row + 1
  const width = range.to.column - range.from.column + 1
  if (
    !Array.isArray(edit.values) ||
    edit.values.length !== height ||
    edit.values.some((row) => !Array.isArray(row) || row.length !== width)
  )
    throw new Error('Values dimensions must match the range')
  const sheet = await book.sheet(edit.sheet)
  const inputs = new Map<string, NormalCell>()
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++)
      inputs.set(
        cellAddress(range.from.row + r, range.from.column + c),
        normalizeInput(edit.values[r][c])
      )
  assertEditable(book, sheet, [...inputs.keys()])
  const changes = new Map<string, string>()
  for (const [address, input] of inputs) {
    const old = sheet.cells.get(address)
    if (
      input.formula !== undefined
        ? old?.formula === input.formula
        : old?.formula === undefined && (old?.value ?? null) === input.value
    )
      continue
    changes.set(address, cellXml(sheet, address, input))
  }
  if (!changes.size) return book.original
  // Unshare every existing member of a touched shared group, including when editing a blank in its ref.
  const groups = new Set<string>()
  for (const cell of sheet.cells.values()) {
    const f = sc(cell.node, 'f')
    if (f?.attrs.t !== 'shared') continue
    if (
      changes.has(cell.address) ||
      (f.attrs.ref &&
        [...changes.keys()].some((a) => contains(parseRange(f.attrs.ref), parseCell(a))))
    )
      groups.add(f.attrs.si)
  }
  for (const cell of sheet.cells.values()) {
    const f = sc(cell.node, 'f')
    if (f?.attrs.t !== 'shared' || !groups.has(f.attrs.si) || changes.has(cell.address)) continue
    if (!cell.formula) throw new Error('Cannot expand shared formula')
    const raw = rawNode(sheet.source, cell.node)
    changes.set(
      cell.address,
      patchXml(raw, [
        {
          start: f.start - cell.node.start,
          end: f.end - cell.node.start,
          text: sTag('f', escapeXml(cell.formula)),
        },
      ])
    )
  }
  let source = patchCells(sheet, changes)
  const updated = await parseXml(source)
  const dimension = sc(updated, 'dimension')
  const maxRow = Math.max(sheet.maxRow, range.to.row)
  const maxCol = Math.max(sheet.maxColumn, range.to.column)
  if (dimension)
    source = patchXml(source, [
      {
        start: dimension.start,
        end: dimension.end,
        text: setAttributes(source, dimension, { ref: `A1:${cellAddress(maxRow, maxCol)}` }),
      },
    ])
  const mutation = new PackageMutation(book)
  mutation.set(sheet.part, source)
  await invalidateCalculation(book, mutation)
  return mutation.finish()
}
