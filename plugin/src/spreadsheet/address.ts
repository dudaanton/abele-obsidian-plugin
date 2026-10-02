export const MAX_ROWS = 1048576
export const MAX_COLUMNS = 16384
export interface CellPosition {
  row: number
  column: number
}
export interface CellRange {
  from: CellPosition
  to: CellPosition
}
export function columnName(column: number): string {
  let name = ''
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}
export function cellAddress(row: number, column: number): string {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 1 ||
    column < 1 ||
    row > MAX_ROWS ||
    column > MAX_COLUMNS
  )
    throw new Error('Invalid cell address')
  return columnName(column) + row
}
export function parseCell(address: string): CellPosition {
  const m = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/i.exec(address)
  if (!m) throw new Error('Invalid cell address')
  const column = [...m[1].toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
  const row = Number(m[2])
  cellAddress(row, column)
  return { row, column }
}
export function parseRange(input: string, maxCells = Infinity): CellRange {
  if (typeof input !== 'string') throw new Error('Name an A1 range')
  const parts = input.split(':')
  if (parts.length > 2) throw new Error('Invalid range')
  const from = parseCell(parts[0])
  const to = parseCell(parts[1] ?? parts[0])
  if (
    to.row < from.row ||
    to.column < from.column ||
    (to.row - from.row + 1) * (to.column - from.column + 1) > maxCells
  )
    throw new Error('Invalid or too large cell range')
  return { from, to }
}
export const contains = (range: CellRange, pos: CellPosition) =>
  pos.row >= range.from.row &&
  pos.row <= range.to.row &&
  pos.column >= range.from.column &&
  pos.column <= range.to.column
/** Shared-formula translation. Quoted literals/sheet names are never mistaken for references. */
export function translateFormula(formula: string, rows: number, columns: number): string {
  if (/\[|\]|(?:'[^']*'|\w+):(?:'[^']*'|\w+)!/.test(formula))
    throw new Error('Unsupported shared formula references')
  return formula.replace(
    /"(?:[^"]|"")*"|'(?:[^']|'')*'|(?<![\w.])\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?![\w.(]|\s*!)/gi,
    (token) => {
      if (token.startsWith('"') || token.startsWith("'")) return token
      const m = /^(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(token)!
      const pos = parseCell(token)
      const row = pos.row + (m[3] ? 0 : rows)
      const column = pos.column + (m[1] ? 0 : columns)
      if (row < 1 || column < 1 || row > MAX_ROWS || column > MAX_COLUMNS) return '#REF!'
      return m[1] + columnName(column) + m[3] + row
    }
  )
}
