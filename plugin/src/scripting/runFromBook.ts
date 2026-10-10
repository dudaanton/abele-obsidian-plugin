/** Reader-compatible launch adapter. Both sources share admission, parameters and picker UI. */
import { Notice, type App } from 'obsidian'
import { ScriptService } from './ScriptService'
import { ScriptWaitingError } from './ScriptTrust'
import {
  SelectionScriptPicker as BookScriptPicker,
  setOnSelectionMenu,
} from './SelectionScriptPicker'
import type { BookScriptContext } from './bookContext'
import type { ParsedScript } from './types'

export { SelectionScriptPicker as BookScriptPicker } from './SelectionScriptPicker'
export { selectionParams as bookParams } from './runFromSelection'

/** The scripts with a button of their own on words in a book, by name. */
export function bookScripts(all: ParsedScript[]): ParsedScript[] {
  return all.filter((s) => s.meta.book).sort((a, b) => a.meta.name.localeCompare(b.meta.name))
}

export async function runScriptOnBook(
  script: ParsedScript,
  book: BookScriptContext
): Promise<void> {
  try {
    const outcome = await ScriptService.getInstance().executeFromSelection(script.path, {
      kind: 'book',
      book,
    })
    if (outcome.status !== 'done') return
    const result = outcome.output
    if (result.trim()) new Notice(result.length > 500 ? `${result.slice(0, 500)}…` : result, 10000)
    else new Notice(`${script.meta.name}: done`)
  } catch (err) {
    if (err instanceof ScriptWaitingError) return
    new Notice(`${script.meta.name}: ${err instanceof Error ? err.message : String(err)}`, 10000)
    console.error(`[Abele] script "${script.meta.name}" on a book failed`, err)
  }
}

export async function setOnBookMenu(script: string, on: boolean): Promise<void> {
  return setOnSelectionMenu(script, on, 'book')
}

export function pickScriptForBook(app: App, book: BookScriptContext): void {
  const scripts = ScriptService.getInstance().getAll()
  if (!scripts.length) {
    new Notice('There are no scripts yet: add one to the scripts folder')
    return
  }
  const captured = Object.freeze({ ...book })
  new BookScriptPicker(app, scripts, (s) => void runScriptOnBook(s, captured)).open()
}

export function runOnBook(app: App, book: BookScriptContext, name?: string): void {
  if (!name) {
    pickScriptForBook(app, book)
    return
  }
  const script = ScriptService.getInstance()
    .getAll()
    .find((s) => s.meta.name === name)
  if (!script) new Notice(`Script "${name}" not found`)
  else void runScriptOnBook(script, book)
}
