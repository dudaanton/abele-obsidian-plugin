import type { App } from 'obsidian'
import { TextInputSuggest } from './suggest'
import { folderOf, noteSuggestions, titleOf, type NoteFilter, type NotePick } from '../noteFilter'

export interface FilteredNoteSuggestOptions {
  filter?: NoteFilter
  create?: boolean
  /** Notes already taken, left out of the list. Read on every keystroke. */
  taken?: () => ReadonlySet<string>
  onPick: (pick: NotePick) => void
  /** Keep the list up after a pick, for a field that takes several notes in a row. */
  keepOpen?: boolean
}

/**
 * The quick switcher over a filtered part of the vault: fuzzy matched on the note's title and
 * its path, each line the title with its folder under it, as Obsidian draws its own. Taking one
 * empties the field, because what was taken is shown by whoever owns the field, not in it —
 * and `onPick` runs before the list is drawn again, so a note just taken is already left out.
 */
export class FilteredNoteSuggest extends TextInputSuggest<NotePick> {
  constructor(
    private readonly vaultApp: App,
    inputEl: HTMLInputElement,
    private readonly options: FilteredNoteSuggestOptions
  ) {
    super(vaultApp, inputEl)
  }

  getSuggestions(query: string): NotePick[] {
    return noteSuggestions(this.vaultApp, {
      filter: this.options.filter,
      query,
      exclude: this.options.taken?.(),
      create: this.options.create,
    })
  }

  renderSuggestion(pick: NotePick, el: HTMLElement): void {
    el.addClass('mod-complex')
    const content = el.createDiv({ cls: 'suggestion-content' })
    if ('create' in pick) {
      content.createDiv({ cls: 'suggestion-title', text: `Create "${pick.create}"` })
      content.createDiv({ cls: 'suggestion-note', text: 'New note' })
      return
    }
    content.createDiv({ cls: 'suggestion-title', text: titleOf(this.vaultApp, pick.file) })
    const folder = folderOf(pick.file)
    if (folder) content.createDiv({ cls: 'suggestion-note', text: folder })
  }

  selectSuggestion(pick: NotePick): void {
    this.inputEl.value = ''
    this.options.onPick(pick)
    if (this.options.keepOpen) this.refresh()
    else this.close()
  }
}
