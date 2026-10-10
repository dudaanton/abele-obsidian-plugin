import { FuzzySuggestModal, Notice, setIcon, type App, type FuzzyMatch } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { readerSettingsFrom } from '@/reader/settings'
import {
  selectionMenu,
  selectionMenuPlace,
  selectionMenuScriptsFrom,
  withSelectionScript,
  withoutSelectionScript,
  type SelectionMenuSurface,
} from './selectionMenuScripts'
import type { ParsedScript } from './types'
import './SelectionScriptPicker.scss'

function chosen(surface: SelectionMenuSurface) {
  const config = AbeleConfig.getInstance()
  return surface === 'book'
    ? readerSettingsFrom(config.reader).selectionScripts
    : selectionMenuScriptsFrom(config.ai.chatSelectionScripts)
}

/** Pinning edits membership only on this surface; it never runs a script. */
export async function setOnSelectionMenu(
  script: string,
  on: boolean,
  surface: SelectionMenuSurface
): Promise<void> {
  const config = AbeleConfig.getInstance()
  const list = chosen(surface)
  const selectionScripts = on
    ? withSelectionScript(list, script)
    : withoutSelectionScript(list, script)
  if (surface === 'book') config.reader = { ...readerSettingsFrom(config.reader), selectionScripts }
  else config.ai = { ...config.ai, chatSelectionScripts: selectionScripts }
  await config.saveSettings()
  new Notice(`${script} is ${on ? 'on' : 'off'} the ${surface} menu`)
}

/** Native searchable suggestions, shared by reader and chat; long lists scroll natively. */
export class SelectionScriptPicker extends FuzzySuggestModal<ParsedScript> {
  constructor(
    app: App,
    private readonly scripts: ParsedScript[],
    private readonly pick: (s: ParsedScript) => void,
    private readonly surface: SelectionMenuSurface = 'book'
  ) {
    super(app)
    this.setPlaceholder('Run a script on these words…')
    this.setInstructions([
      { command: '↵', purpose: 'to run' },
      { command: 'pin', purpose: `to keep it on the ${surface} selection menu` },
    ])
  }

  getItems(): ParsedScript[] {
    const menu = selectionMenu(this.scripts, chosen(this.surface), this.surface).map(
      (i) => i.script
    )
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

  renderSuggestion(match: FuzzyMatch<ParsedScript>, el: HTMLElement): void {
    const s = match.item
    el.addClass('mod-complex', 'abele-book-script-choice', 'abele-selection-script-choice')
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: s.meta.name })
    if (s.meta.description) content.createDiv({ cls: 'suggestion-note', text: s.meta.description })
    const pin = el.createDiv({ cls: 'suggestion-aux' }).createEl('button', {
      cls: 'clickable-icon abele-book-script-pin',
      attr: { type: 'button' },
    })
    const draw = () => {
      const place = selectionMenuPlace(s, chosen(this.surface), this.surface)
      pin.empty()
      setIcon(pin, place === 'setting' ? 'pin-off' : 'pin')
      pin.toggleClass('is-active', place !== null)
      pin.toggleClass('is-disabled', place === 'header')
      pin.dataset.place = place ?? ''
      pin.setAttribute(
        'aria-label',
        place === 'setting'
          ? `Take it off the ${this.surface} menu`
          : place === 'header'
            ? `On the ${this.surface} menu by its header`
            : `Keep it on the ${this.surface} menu`
      )
    }
    draw()
    // The native suggestion scope uses Enter to run the selected row. A focused pin owns
    // Enter/Space instead, just like its pointer click, and leaves that scope untouched.
    pin.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' && evt.key !== ' ') return
      evt.preventDefault()
      evt.stopPropagation()
      pin.click()
    })
    pin.addEventListener('click', (evt) => {
      evt.preventDefault()
      evt.stopPropagation()
      const place = selectionMenuPlace(s, chosen(this.surface), this.surface)
      if (place === 'header') return
      void setOnSelectionMenu(s.meta.name, place !== 'setting', this.surface)
        .then(draw)
        .catch((error) => new Notice(error instanceof Error ? error.message : String(error)))
    })
  }

  onChooseItem(s: ParsedScript): void {
    this.pick(s)
  }
}
