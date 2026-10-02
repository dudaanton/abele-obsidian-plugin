import type { App, TFile } from 'obsidian'
import { wordRevision as workbookRevision } from '@/ooxml/write'
import { writeOfficeChange } from '@/ooxml/vaultAdapter'
import { openXlsx } from './package'
import type { WorkbookEdit } from './edit'
import { applyCalculatedEdit } from './calculation'
import type { Workbook } from './package'
import { readRange } from './read'
export async function validateWorkbookBytes(bytes: Uint8Array): Promise<void> {
  const book = await loadWorkbookBytes(bytes)
  for (const info of book.sheets) await book.sheet(info.name)
}
export const writeWorkbookChange = (app: App, file: TFile, original: Uint8Array, updated: Uint8Array, signal?: AbortSignal) =>
  writeOfficeChange(app,file,original,updated,signal,undefined,validateWorkbookBytes)
import { cellAddress, parseRange } from './address'
import { defaultStyle } from './styles'
async function workbookPreview(book: Workbook, edit: WorkbookEdit): Promise<string> {
  let text =
    edit.operation === 'recalculate'
      ? 'Formula caches\n'
      : readRange(book, await book.sheet(edit.sheet), edit.range) + '\n\nDependent formula caches\n'
  if (edit.operation === 'format') {
    const sheet = await book.sheet(edit.sheet)
    const { from, to } = parseRange(edit.range, 1000)
    for (let r = from.row; r <= to.row; r++)
      for (let c = from.column; c <= to.column; c++) {
        const address = cellAddress(r, c)
        const style = sheet.cells.get(address)?.style ?? defaultStyle
        text += `${address}: bold=${style.bold}, italic=${style.italic}, fill=${style.fill ?? 'none'}, number format=${style.numberFormat}\n`
      }
    return text.slice(0, 24000) + (text.length > 24000 ? '\n[Style preview truncated.]' : '')
  }
  for (const info of book.sheets) {
    const sheet = await book.sheet(info.name)
    for (const cell of sheet.cells.values()) {
      if (cell.formula === undefined) continue
      text += `${info.name}!${cell.address}: =${cell.formula} → ${cell.value ?? '(pending)'}\n`
      if (text.length > 24000)
        return (
          text.slice(0, 24000) +
          '\n[Preview truncated; formulas beyond this window may also recalculate.]'
        )
    }
  }
  return text
}
export const loadWorkbookBytes = (bytes: Uint8Array, readOnly = false) =>
  openXlsx(bytes, readOnly, () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)))
export async function prepareWorkbookChange(
  app: App,
  file: TFile,
  edit: WorkbookEdit,
  revision: string,
  signal?: AbortSignal
) {
  if (!['xlsx', 'xlsm'].includes(file.extension.toLowerCase()))
    throw new Error('Name a workbook file')
  const original = new Uint8Array(await app.vault.readBinary(file))
  if (!revision || workbookRevision(original) !== revision)
    throw new Error('Workbook changed since it was read. Read it again and pass its revision.')
  const book = await loadWorkbookBytes(original, file.extension.toLowerCase() === 'xlsm')
  const old = await workbookPreview(book, edit)
  const calculation = await applyCalculatedEdit(book, edit, signal)
  const updated = calculation.bytes
  const after = await loadWorkbookBytes(updated)
  return { original, updated, calculation, diff: { old, new: await workbookPreview(after, edit) } }
}
