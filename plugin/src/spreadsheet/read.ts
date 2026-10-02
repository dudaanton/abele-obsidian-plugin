import { cellAddress, parseRange } from './address'
import { formatValue } from './styles'
import type { Workbook, WorkbookSheet } from './package'
export function readRange(
  book: Workbook,
  sheet: WorkbookSheet,
  range: string,
  format = 'markdown'
): string {
  const { from, to } = parseRange(range, 1000)
  const lines: string[] = []
  const escape = (text: string) =>
    format === 'csv'
      ? '"' + text.replaceAll('"', '""') + '"'
      : text.replaceAll('|', '\\|').replaceAll('\n', ' ↵ ')
  for (let row = from.row; row <= to.row; row++) {
    const values = []
    for (let col = from.column; col <= to.column; col++) {
      const address = cellAddress(row, col)
      const cell = sheet.cells.get(address)
      values.push(
        escape(
          `${address}: ${formatValue(cell?.value ?? null, cell?.style.numberFormat ?? 'General', book.date1904)}${cell?.formula !== undefined ? ` [=${cell.formula}${cell.value === null ? '; pending' : ''}]` : ''}`
        )
      )
    }
    lines.push(format === 'csv' ? values.join(',') : '| ' + values.join(' | ') + ' |')
  }
  if (format !== 'csv')
    lines.splice(
      1,
      0,
      '| ' +
        Array(to.column - from.column + 1)
          .fill('---')
          .join(' | ') +
        ' |'
    )
  return lines.join('\n')
}
