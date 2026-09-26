/**
 * Running a script on words selected in a book (or on a highlight): from the reader's selection
 * bar, where the book menu's scripts — chosen in the settings or pinned from the list, and those
 * whose header says `// @book` — are offered first and any other is picked from a list.
 *
 * The script is given the words as `book` — with a link to their place, the book, the chapter and
 * the sentence they are in — and every parameter marked `selection` starts out as the words.
 * The form is shown only when a required parameter is still empty: a script that needs nothing
 * more runs at one tap.
 */
import { FuzzySuggestModal, Notice, setIcon, type App, type FuzzyMatch } from 'obsidian'
import { ScriptService } from './ScriptService'
import { showFormModal } from './formModal'
import { AbeleConfig } from '@/services/AbeleConfig'
import { readerSettingsFrom } from '@/reader/settings'
import { bookMenu, bookMenuPlace, withBookScript, withoutBookScript } from './bookMenuScripts'
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

/** Puts `script` on the book menu or takes it off, in the settings, and says so. */
export async function setOnBookMenu(script: string, on: boolean): Promise<void> {
  const config = AbeleConfig.getInstance()
  const now = readerSettingsFrom(config.reader)
  const selectionScripts = on
    ? withBookScript(now.selectionScripts, script)
    : withoutBookScript(now.selectionScripts, script)
  config.reader = { ...now, selectionScripts }
  await config.saveSettings()
  new Notice(on ? `${script} is on the book menu` : `${script} is off the book menu`)
}

/**
 * A list of the scripts to pick one to run on the words: the book menu's first, in its order,
 * then the rest by name. Each has a pin beside it that puts it on the book menu or takes it off,
 * so the menu is set up where it is used; one put there by its header says so instead.
 */
export class BookScriptPicker extends FuzzySuggestModal<ParsedScript> {
  constructor(
    app: App,
    private readonly scripts: ParsedScript[],
    private readonly pick: (s: ParsedScript) => void
  ) {
    super(app)
    this.setPlaceholder('Run a script on these words…')
    this.setInstructions([
      { command: '↵', purpose: 'to run' },
      { command: 'pin', purpose: 'to keep it on the bar for words in a book' },
    ])
  }

  private chosen() {
    return readerSettingsFrom(AbeleConfig.getInstance().reader).selectionScripts
  }

  getItems(): ParsedScript[] {
    const menu = bookMenu(this.scripts, this.chosen()).map((i) => i.script)
    const byName = new Map(this.scripts.map((s) => [s.meta.name, s]))
    const first = menu.map((name) => byName.get(name)).filter((s): s is ParsedScript => !!s)
    const rest = this.scripts
      .filter((s) => !menu.includes(s.meta.name))
      .sort((a, b) => a.meta.name.localeCompare(b.meta.name))
    return [...first, ...rest]
  }

  getItemText(s: ParsedScript): string {
    return s.meta.description ? `${s.meta.name} — ${s.meta.description}` : s.meta.name
  }

  /** Name over description, and the pin at the end of the row, in Obsidian's own classes. */
  renderSuggestion(match: FuzzyMatch<ParsedScript>, el: HTMLElement): void {
    const s = match.item
    el.addClass('mod-complex', 'abele-book-script-choice')
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: s.meta.name })
    if (s.meta.description) content.createDiv({ cls: 'suggestion-note', text: s.meta.description })
    const pin = el
      .createDiv({ cls: 'suggestion-aux' })
      .createDiv({ cls: 'clickable-icon abele-book-script-pin' })
    const draw = () => {
      const place = bookMenuPlace(s, this.chosen())
      pin.empty()
      setIcon(pin, place === 'setting' ? 'pin-off' : 'pin')
      pin.toggleClass('is-active', place !== null)
      pin.toggleClass('is-disabled', place === 'header')
      pin.dataset.place = place ?? ''
      pin.setAttribute(
        'aria-label',
        place === 'setting'
          ? 'Take it off the book menu'
          : place === 'header'
            ? 'On the book menu by its header'
            : 'Keep it on the book menu'
      )
    }
    draw()
    // The row runs the script on a tap; the pin only pins, and leaves the list open.
    pin.addEventListener('click', (evt) => {
      evt.preventDefault()
      evt.stopPropagation()
      const place = bookMenuPlace(s, this.chosen())
      if (place === 'header') return
      void setOnBookMenu(s.meta.name, place !== 'setting').then(draw)
    })
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
