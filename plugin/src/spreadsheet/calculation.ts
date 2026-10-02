/** Bounded, sparse local formula evaluation. HyperFormula is GPL-3.0, like the repository LICENSE. */
import { AlwaysSparse, DetailedCellError, HyperFormula } from 'hyperformula'
import { PackageMutation, nodeWithContent, setAttributes } from '@/ooxml/mutation'
import { escapeXml, patchXml, rawNode, type Patch } from '@/ooxml/xml'
import { MAX_COLUMNS, MAX_ROWS } from './address'
import {
  applyWorkbookEdit,
  assertEditable,
  invalidateCalculation,
  sTag,
  type WorkbookEdit,
} from './edit'
import {
  openXlsx,
  type Workbook,
  type WorkbookCell,
  type WorkbookSheet,
  valueText,
} from './package'
import { sc } from './styles'
import { applyWorkbookFormat } from './format'
import { escapeSpreadsheetText } from './text'
import { applyWorkbookRows } from './rows'
export interface CalculationResult {
  bytes: Uint8Array
  complete: boolean
  note: string
}
export async function applyCalculatedEdit(
  book: Workbook,
  edit: WorkbookEdit,
  signal?: AbortSignal,
  yieldTask: () => Promise<void> = () => Promise.resolve()
): Promise<CalculationResult> {
  if (
    edit.operation &&
    !['cells', 'recalculate', 'format', 'row_add', 'row_delete'].includes(edit.operation)
  )
    throw new Error('Unknown workbook operation')
  if (edit.operation === 'row_add' || edit.operation === 'row_delete')
    return {
      bytes: await applyWorkbookRows(book, {
        sheet: edit.sheet,
        operation: edit.operation,
        rows: edit.rows,
      }),
      complete: !book.stale,
      note: 'Trailing rows updated; existing cell addresses did not shift.',
    }
  if (edit.operation === 'format')
    return {
      bytes: await applyWorkbookFormat(book, {
        sheet: edit.sheet,
        range: edit.range,
        format: edit.format,
      }),
      complete: !book.stale,
      note: 'Cell formatting updated; formula caches unchanged.',
    }
  if (edit.operation === 'recalculate') {
    for (const info of book.sheets) assertEditable(book, await book.sheet(info.name), [])
    return recalculateWorkbook(book, { signal, yieldTask })
  }
  const updated = await applyWorkbookEdit(book, edit)
  if (updated === book.original)
    return {
      bytes: updated,
      complete: !book.stale,
      note: 'No cell changes; original workbook retained.',
    }
  const after = await openXlsx(updated, false, yieldTask)
  return recalculateWorkbook(after, { signal, yieldTask })
}
const excelErrors = new Set([
  '#DIV/0!',
  '#N/A',
  '#NAME?',
  '#NULL!',
  '#NUM!',
  '#REF!',
  '#VALUE!',
  '#GETTING_DATA',
])
export async function recalculateWorkbook(
  book: Workbook,
  options: { maxCells?: number; signal?: AbortSignal; yieldTask?: () => Promise<void> } = {}
): Promise<CalculationResult> {
  const sheets: WorkbookSheet[] = []
  let count = 0
  for (const info of book.sheets) {
    options.signal?.throwIfAborted()
    const sheet = await book.sheet(info.name)
    count += sheet.cells.size
    if (count > (options.maxCells ?? 20000))
      return {
        bytes: book.original,
        complete: false,
        note: 'Local calculation cell limit exceeded (20000); values may be stale. Recalculate in a spreadsheet app.',
      }
    sheets.push(sheet)
  }
  if (
    sheets.some((s) =>
      [...s.cells.values()].some((c) => {
        const f = sc(c.node, 'f')
        return (
          (f?.attrs.t && !['shared', 'normal'].includes(f.attrs.t)) ||
          c.node.attrs.cm !== undefined ||
          c.node.attrs.vm !== undefined ||
          !!c.formulaProblem
        )
      })
    )
  )
    return {
      bytes: book.original,
      complete: false,
      note: 'Array/data-table, unsupported shared formulas or dynamic formula metadata is not locally calculated; values may be stale.',
    }
  const hf = HyperFormula.buildEmpty({
    licenseKey: 'gpl-v3',
    chooseAddressMappingPolicy: new AlwaysSparse(),
    maxRows: MAX_ROWS,
    maxColumns: MAX_COLUMNS,
    leapYear1900: !book.date1904,
    nullDate: book.date1904 ? { year: 1904, month: 1, day: 1 } : { year: 1899, month: 12, day: 31 },
    useColumnIndex: true,
  })
  const mutation = new PackageMutation(book)
  let complete = true
  let errors = 0
  try {
    hf.suspendEvaluation()
    const ids = new Map<string, number>()
    for (const sheet of sheets) {
      hf.addSheet(sheet.name)
      ids.set(sheet.name, hf.getSheetId(sheet.name))
    }
    let fed = 0
    for (const sheet of sheets)
      for (const cell of sheet.cells.values()) {
        options.signal?.throwIfAborted()
        const input =
          cell.formula !== undefined
            ? '=' + cell.formula
            : typeof cell.value === 'string' && cell.node.attrs.t !== 'e'
              ? "'" + cell.value
              : cell.value
        hf.setCellContents(
          { sheet: ids.get(sheet.name), row: cell.row - 1, col: cell.column - 1 },
          [[input]]
        )
        if (++fed % 500 === 0 && options.yieldTask) await options.yieldTask()
      }
    for (const named of sc(book.workbookTree, 'definedNames')?.children ?? []) {
      if (named.attrs.name?.startsWith('_xlnm.')) continue
      try {
        const scope =
          named.attrs.localSheetId === undefined
            ? undefined
            : ids.get(sheets[Number(named.attrs.localSheetId)]?.name)
        hf.addNamedExpression(named.attrs.name, '=' + valueText(book.workbookSource, named), scope)
      } catch {
        complete = false
      }
    }
    options.signal?.throwIfAborted()
    hf.resumeEvaluation()
    for (const sheet of sheets) {
      const patches: Patch[] = []
      for (const cell of sheet.cells.values()) {
        if (cell.formula === undefined) continue
        const value = hf.getCellValue({
          sheet: ids.get(sheet.name),
          row: cell.row - 1,
          col: cell.column - 1,
        })
        const error = value instanceof DetailedCellError
        const text = error
          ? excelErrors.has(value.value)
            ? value.value
            : '#REF!'
          : value === null
            ? ''
            : String(value)
        if (error) {
          errors++
          complete = false
        }
        const type = error
          ? 'e'
          : typeof value === 'string'
            ? 'str'
            : typeof value === 'boolean'
              ? 'b'
              : null
        const rawValue = typeof value === 'boolean' ? (value ? '1' : '0') : text
        const sameType =
          type === null
            ? !cell.node.attrs.t || cell.node.attrs.t === 'n'
            : cell.node.attrs.t === type
        if (sameType && sc(cell.node, 'v') && cell.value === (error ? text : value)) continue
        patches.push({
          start: cell.node.start,
          end: cell.node.end,
          text: cachedCell(sheet, cell, rawValue, type),
        })
      }
      if (patches.length) mutation.set(sheet.part, patchXml(sheet.source, patches))
    }
    if (mutation.parts.size) await invalidateCalculation(book, mutation)
    return {
      bytes: await mutation.finish(),
      complete,
      note: complete
        ? 'Calculated locally; the spreadsheet app also recalculates on open.'
        : `Calculated locally with ${errors} formula error(s) or unsupported names; unsupported functions show #NAME?. Check results in a spreadsheet app.`,
    }
  } catch (e) {
    options.signal?.throwIfAborted()
    return {
      bytes: book.original,
      complete: false,
      note: `Local calculation unavailable: ${(e as Error).message}. Values may be stale.`,
    }
  } finally {
    hf.destroy()
  }
}
function cachedCell(
  sheet: WorkbookSheet,
  cell: WorkbookCell,
  value: string,
  type: string | null
): string {
  const node = cell.node
  const oldValue = sc(node, 'v')
  const fragment = sTag('v', type === 'str' ? escapeSpreadsheetText(value) : escapeXml(value))
  let raw = rawNode(sheet.source, node)
  if (oldValue)
    raw = patchXml(raw, [
      { start: oldValue.start - node.start, end: oldValue.end - node.start, text: fragment },
    ])
  else {
    const f = sc(node, 'f')
    if (f)
      raw = patchXml(raw, [{ start: f.end - node.start, end: f.end - node.start, text: fragment }])
    else raw = nodeWithContent(sheet.source, node, fragment)
  }
  return setAttributes(
    raw,
    { ...node, start: 0, openEnd: node.openEnd - node.start, end: raw.length },
    { t: type }
  )
}
