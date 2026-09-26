/**
 * Running a script on words selected in a book (or on a highlight): from the reader's selection
 * bar, where a script whose header says `// @book` has a button of its own and any other is
 * picked from a list.
 *
 * The script is given the words as `book` — with a link to their place, the book, the chapter and
 * the sentence they are in — and every parameter marked `selection` starts out as the words.
 * The form is shown only when a required parameter is still empty: a script that needs nothing
 * more runs at one tap.
 */
import { FuzzySuggestModal, Notice, type App } from 'obsidian'
import { ScriptService } from './ScriptService'
import { showFormModal } from './formModal'
import type { BookScriptContext } from './bookContext'
import type { ParsedScript } from './types'

/** What a script run on `words` is passed, and whether a required parameter is left empty. */
export function bookParams(
  script: ParsedScript,
  words: string
): { params: Record<string, unknown>; missing: boolean } {
  const params: Record<string, unknown> = {}
  let missing = false
  for (const p of script.meta.params) {
    const value = p.selection && words ? words : p.default
    if (value === undefined || value === '') {
      if (p.required) missing = true
      continue
    }
    if (p.type === 'boolean') params[p.name] = value === 'true'
    else if (p.type === 'number') params[p.name] = Number(value)
    else params[p.name] = value
  }
  return { params, missing }
}

/** The scripts with a button of their own on words in a book, by name. */
export function bookScripts(all: ParsedScript[]): ParsedScript[] {
  return all.filter((s) => s.meta.book).sort((a, b) => a.meta.name.localeCompare(b.meta.name))
}

/** Runs `script` on words in a book and says how it went. */
export async function runScriptOnBook(
  script: ParsedScript,
  book: BookScriptContext
): Promise<void> {
  const service = ScriptService.getInstance()
  let { params, missing } = bookParams(script, book.text)
  if (missing) {
    const asked = await service.showParamForm(script, book.text)
    if (!asked) return
    params = asked
  }
  try {
    const result = await service.execute(script.path, params, {
      source: 'book',
      book,
      formHandler: showFormModal,
    })
    if (result.trim()) new Notice(result.length > 500 ? `${result.slice(0, 500)}…` : result, 10000)
    else new Notice(`${script.meta.name}: done`)
  } catch (err) {
    new Notice(`${script.meta.name}: ${err instanceof Error ? err.message : String(err)}`, 10000)
    console.error(`[Abele] script "${script.meta.name}" on a book failed`, err)
  }
}

/** A list of the scripts to pick one to run on the words; the `@book` ones first. */
class BookScriptPicker extends FuzzySuggestModal<ParsedScript> {
  constructor(
    app: App,
    private readonly scripts: ParsedScript[],
    private readonly pick: (s: ParsedScript) => void
  ) {
    super(app)
    this.setPlaceholder('Run a script on these words…')
  }

  getItems(): ParsedScript[] {
    const pinned = bookScripts(this.scripts)
    const rest = this.scripts
      .filter((s) => !s.meta.book)
      .sort((a, b) => a.meta.name.localeCompare(b.meta.name))
    return [...pinned, ...rest]
  }

  getItemText(s: ParsedScript): string {
    return s.meta.description ? `${s.meta.name} — ${s.meta.description}` : s.meta.name
  }

  onChooseItem(s: ParsedScript): void {
    this.pick(s)
  }
}

/** Asks which script to run on the words, then runs it. */
export function pickScriptForBook(app: App, book: BookScriptContext): void {
  const scripts = ScriptService.getInstance().getAll()
  if (!scripts.length) {
    new Notice('There are no scripts yet: add one to the scripts folder')
    return
  }
  new BookScriptPicker(app, scripts, (s) => void runScriptOnBook(s, book)).open()
}

/** Runs the script named `name` on the words; the picker when no name is given. */
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
