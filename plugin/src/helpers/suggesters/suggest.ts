import { AbstractInputSuggest, App } from 'obsidian'

/**
 * Base for the plugin's path pickers.
 *
 * This used to be the hand-rolled `TextInputSuggest` copied from Templater, which built its own
 * popup and positioned it with Popper. Obsidian ships `AbstractInputSuggest` for exactly this,
 * and its plugin guidelines ask for it — so the popup, its placement, the keyboard handling and
 * the window it belongs to are all Obsidian's job now. That also retires the bug this file used
 * to carry, where a picker opened in the settings window hung its list in the main one.
 *
 * What remains here is only what a picker actually has to say: which values match the query,
 * how to draw one, and what to do when the user takes it.
 */
export abstract class TextInputSuggest<T> extends AbstractInputSuggest<T> {
  constructor(
    app: App,
    protected readonly inputEl: HTMLInputElement
  ) {
    super(app, inputEl)
  }

  /**
   * Runs the query again over the text now in the field, keeping the list open.
   *
   * Used by callers that override `selectSuggestion` to collect several values in a row — the
   * scope editor adds each pick to a list rather than filling the field with it, so the list
   * should stay up. Written as an `input` event because that is what the base class listens to.
   */
  refresh(): void {
    this.inputEl.trigger('input')
  }

  /**
   * Fills the field and tells everything bound to it. `SearchComponent.onChange` — which is how
   * the Vue components observe these fields — listens for `input`, so the event is the point.
   */
  protected applyValue(value: string): void {
    this.inputEl.value = value
    this.inputEl.trigger('input')
    this.close()
  }

  abstract getSuggestions(inputStr: string): T[]
  abstract renderSuggestion(item: T, el: HTMLElement): void
  abstract selectSuggestion(item: T): void
}
