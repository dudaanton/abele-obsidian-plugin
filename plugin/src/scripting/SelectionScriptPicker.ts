import { FuzzySuggestModal, Notice, type App, type FuzzyMatch } from 'obsidian'
import { h } from 'vue'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'
import SelectionScriptPin from './SelectionScriptPin.vue'
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
  private readonly rows = new SuggestionRows()

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
    this.rows.draw(el, { title: s.meta.name, note: s.meta.description }, () =>
      h(SelectionScriptPin, {
        surface: this.surface,
        placeOf: () => selectionMenuPlace(s, chosen(this.surface), this.surface),
        setOnMenu: (on: boolean) => setOnSelectionMenu(s.meta.name, on, this.surface),
      })
    )
  }

  onClose(): void {
    this.rows.clear()
    super.onClose()
  }

  onChooseItem(s: ParsedScript): void {
    this.pick(s)
  }
}
