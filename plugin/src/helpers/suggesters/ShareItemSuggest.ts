import type { App } from 'obsidian'
import { TextInputSuggest } from './suggest'
import { watchSuggestionKeyboard } from './shareSuggestionKeyboard'
import { coveredBy, itemGlyph, itemName, itemPlace, type ShareItem } from '@/sync/shareSets'

export interface ShareItemSuggestOptions {
  /** Every folder, group and file that may be given. */
  choices: () => ShareItem[]
  /** What is already in the set: left out, and what it covers shown as covered. */
  taken: () => ShareItem[]
  onPick: (item: ShareItem) => void
}

/** Shared by the desktop popup and the phone's inline list. */
export function matchingShareItems(
  choices: ShareItem[],
  taken: ShareItem[],
  query: string
): ShareItem[] {
  const ids = new Set(taken.map((one) => one.id))
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return choices
    .filter((one) => !ids.has(one.id))
    .filter((one) => one.kind !== 'vault' || !taken.length)
    .filter((one) => words.every((w) => (one.path + ' ' + itemName(one)).toLowerCase().includes(w)))
    .slice(0, 50)
}

/**
 * The folders, groups and files of the vault to put in a share, by typing, as Obsidian's own
 * pickers list them: the kind as a glyph, the name, where it lies. One already inside a folder
 * of the set stays in the list, faint, saying which, and is not taken. The whole vault is only
 * offered alone. The list stays up after a pick, for taking several in a row.
 */
export class ShareItemSuggest extends TextInputSuggest<ShareItem> {
  private stopKeyboard?: () => void
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly options: ShareItemSuggestOptions
  ) {
    super(app, inputEl)
  }

  getSuggestions(query: string): ShareItem[] {
    return matchingShareItems(this.options.choices(), this.options.taken(), query)
  }

  renderSuggestion(item: ShareItem, el: HTMLElement): void {
    el.dataset.shareKind = item.kind
    const popup = el.closest<HTMLElement>('.suggestion-container')
    if (popup && !this.stopKeyboard)
      this.stopKeyboard = watchSuggestionKeyboard(this.inputEl, popup)
    const covered = coveredBy(item, this.options.taken())
    const place = item.kind === 'vault' ? 'For your own devices' : itemPlace(item)
    this.rows.draw(el, {
      icon: itemGlyph(item),
      title: itemName(item),
      note: place,
      titleClass: covered ? 'abele-share-pick__covered' : undefined,
      aux: covered
        ? [{ flair: 'In ' + itemName(covered), cls: 'abele-share-pick__in' }]
        : undefined,
    })
    el.toggleClass('is-disabled', !!covered)
    el.setAttribute('aria-disabled', covered ? 'true' : 'false')
  }

  selectSuggestion(item: ShareItem): void {
    if (coveredBy(item, this.options.taken())) return
    this.inputEl.value = ''
    this.options.onPick(item)
    this.refresh()
  }

  close(): void {
    this.stopKeyboard?.()
    this.stopKeyboard = undefined
    super.close()
  }
}
