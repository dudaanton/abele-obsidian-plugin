import type { App, TFile } from 'obsidian'
import { wordRevision as workbookRevision } from '@/ooxml/write'
import { writeOfficeChange } from '@/ooxml/vaultAdapter'
import { openXlsx } from './package'
import { applyWorkbookEdit, type WorkbookEdit } from './edit'
import { readRange } from './read'
export async function validateWorkbookBytes(bytes: Uint8Array): Promise<void> {
  const book = await loadWorkbookBytes(bytes)
  for (const info of book.sheets) await book.sheet(info.name)
}
export const writeWorkbookChange = (app: App, file: TFile, original: Uint8Array, updated: Uint8Array, signal?: AbortSignal) =>
  writeOfficeChange(app,file,original,updated,signal,undefined,validateWorkbookBytes)
export const loadWorkbookBytes = (bytes: Uint8Array, readOnly = false) =>
  openXlsx(bytes, readOnly, () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)))
export async function prepareWorkbookChange(
  app: App,
  file: TFile,
  edit: WorkbookEdit,
  revision: string
) {
  if (!['xlsx', 'xlsm'].includes(file.extension.toLowerCase()))
    throw new Error('Name a workbook file')
  const original = new Uint8Array(await app.vault.readBinary(file))
  if (!revision || workbookRevision(original) !== revision)
    throw new Error('Workbook changed since it was read. Read it again and pass its revision.')
  const book = await loadWorkbookBytes(original, file.extension.toLowerCase() === 'xlsm')
  const before = await book.sheet(edit.sheet)
  const old = readRange(book, before, edit.range).slice(0, 25000)
  const updated = await applyWorkbookEdit(book, edit)
  const after = await loadWorkbookBytes(updated)
  return {
    original,
    updated,
    diff: { old, new: readRange(after, await after.sheet(edit.sheet), edit.range).slice(0, 25000) },
  }
}
