/* eslint-disable obsidianmd/prefer-abstract-input-suggest -- this file is that custom
   implementation on purpose; the class comment below says why. */
// Credits go to Templater Plugin: https://github.com/SilentVoid13/Templater

import { App, ISuggestOwner, Scope } from 'obsidian'
import { createPopper, Instance as PopperInstance } from '@popperjs/core'

const wrapAround = (value: number, size: number): number => {
  return ((value % size) + size) % size
}

class Suggest<T> {
  private owner: ISuggestOwner<T>
  private values: T[]
  private suggestions: HTMLDivElement[]
  private selectedItem: number
  private containerEl: HTMLElement

  constructor(owner: ISuggestOwner<T>, containerEl: HTMLElement, scope: Scope) {
    this.owner = owner
    this.containerEl = containerEl

    containerEl.on('click', '.suggestion-item', this.onSuggestionClick.bind(this))
    containerEl.on('mousemove', '.suggestion-item', this.onSuggestionMouseover.bind(this))

    scope.register([], 'ArrowUp', (event) => {
      if (!event.isComposing) {
        this.setSelectedItem(this.selectedItem - 1, true)
        return false
      }
    })

    scope.register([], 'ArrowDown', (event) => {
      if (!event.isComposing) {
        this.setSelectedItem(this.selectedItem + 1, true)
        return false
      }
    })

    scope.register([], 'Enter', (event) => {
      if (!event.isComposing) {
        this.useSelectedItem(event)
        return false
      }
    })
  }

  onSuggestionClick(event: MouseEvent, el: HTMLDivElement): void {
    event.preventDefault()

    const item = this.suggestions.indexOf(el)
    this.setSelectedItem(item, false)
    this.useSelectedItem(event)
  }

  onSuggestionMouseover(_event: MouseEvent, el: HTMLDivElement): void {
    const item = this.suggestions.indexOf(el)
    this.setSelectedItem(item, false)
  }

  setSuggestions(values: T[]) {
    this.containerEl.empty()
    const suggestionEls: HTMLDivElement[] = []

    values.forEach((value) => {
      const suggestionEl = this.containerEl.createDiv('suggestion-item')
      this.owner.renderSuggestion(value, suggestionEl)
      suggestionEls.push(suggestionEl)
    })

    this.values = values
    this.suggestions = suggestionEls
    this.setSelectedItem(0, false)
  }

  useSelectedItem(event: MouseEvent | KeyboardEvent) {
    const currentValue = this.values[this.selectedItem]
    if (currentValue) {
      this.owner.selectSuggestion(currentValue, event)
    }
  }

  setSelectedItem(selectedIndex: number, scrollIntoView: boolean) {
    const normalizedIndex = wrapAround(selectedIndex, this.suggestions.length)
    const prevSelectedSuggestion = this.suggestions[this.selectedItem]
    const selectedSuggestion = this.suggestions[normalizedIndex]

    prevSelectedSuggestion?.removeClass('is-selected')
    selectedSuggestion?.addClass('is-selected')

    this.selectedItem = normalizedIndex

    if (scrollIntoView) {
      selectedSuggestion.scrollIntoView(false)
    }
  }
}

/**
 * Obsidian ships `AbstractInputSuggest`, and its ESLint rule asks plugins to use it. This one
 * is kept deliberately: it accepts a `<textarea>` as well as an `<input>`, which the built-in
 * does not, and where it hangs its popup is covered by `tests/unit/textInputSuggest.test.ts` —
 * the guard against a shipped bug where the popup opened in the main window while the user was
 * typing in the settings window. Moving to the built-in would delete that code and the tests
 * that hold it, so it stays until the swap can be verified against a running app.
 */
export abstract class TextInputSuggest<T> implements ISuggestOwner<T> {
  protected app: App
  protected inputEl: HTMLInputElement | HTMLTextAreaElement

  private popper: PopperInstance
  private scope: Scope
  private suggestEl: HTMLElement
  private suggest: Suggest<T>

  constructor(app: App, inputEl: HTMLInputElement | HTMLTextAreaElement) {
    this.app = app
    this.inputEl = inputEl
    this.scope = new Scope()

    // Built in the input's own document, not through the global `createDiv`, which always
    // builds in the main window. Since Obsidian 1.13 settings can open in a window of their
    // own, and a popup created there would belong to the wrong document entirely.
    this.suggestEl = inputEl.ownerDocument.win.createDiv()
    this.suggestEl.addClass('suggestion-container')
    const suggestion = this.suggestEl.createDiv('suggestion')
    this.suggest = new Suggest(this, suggestion, this.scope)

    this.scope.register([], 'Escape', this.close.bind(this))

    this.inputEl.addEventListener('input', this.onInputChanged.bind(this))
    this.inputEl.addEventListener('focus', this.onInputChanged.bind(this))
    this.inputEl.addEventListener('blur', this.close.bind(this))
    this.suggestEl.on('mousedown', '.suggestion-container', (event: MouseEvent) => {
      event.preventDefault()
    })
  }

  onInputChanged(): void {
    const inputStr = this.inputEl.value
    const suggestions = this.getSuggestions(inputStr)

    if (!suggestions) {
      this.close()
      return
    }

    if (suggestions.length > 0) {
      this.suggest.setSuggestions(suggestions)
      this.open(this.container(), this.inputEl)
    } else {
      this.close()
    }
  }

  /**
   * Where the popup is hung: the window the input actually lives in.
   *
   * `app.dom.appContainerEl` is the main window's, and a settings window opened since
   * Obsidian 1.13 has no `.app-container` of its own — so anchoring there put the file
   * suggestions on top of the note the user was reading, in a different window from the
   * field they were typing into.
   */
  private container(): HTMLElement {
    const doc = this.inputEl.ownerDocument
    const appContainerEl = (this.app as App & { dom?: { appContainerEl?: HTMLElement } }).dom
      ?.appContainerEl

    if (appContainerEl && appContainerEl.ownerDocument === doc) return appContainerEl
    return doc.body
  }

  open(container: HTMLElement, inputEl: HTMLElement): void {
    this.app.keymap.pushScope(this.scope)

    container.appendChild(this.suggestEl)
    this.popper = createPopper(inputEl, this.suggestEl, {
      placement: 'bottom-start',
      modifiers: [
        {
          name: 'sameWidth',
          enabled: true,
          fn: ({ state, instance }) => {
            // Note: positioning needs to be calculated twice -
            // first pass - positioning it according to the width of the popper
            // second pass - position it with the width bound to the reference element
            // we need to early exit to avoid an infinite loop
            const targetWidth = `${state.rects.reference.width}px`
            if (state.styles.popper.width === targetWidth) {
              return
            }
            state.styles.popper.width = targetWidth
            instance.update()
          },
          phase: 'beforeWrite',
          requires: ['computeStyles'],
        },
      ],
    })
  }

  close(): void {
    this.app.keymap.popScope(this.scope)

    this.suggest.setSuggestions([])
    if (this.popper) this.popper.destroy()
    this.suggestEl.detach()
  }

  abstract getSuggestions(inputStr: string): T[]
  abstract renderSuggestion(item: T, el: HTMLElement): void
  abstract selectSuggestion(item: T): void
}
/* eslint-enable obsidianmd/prefer-abstract-input-suggest -- end of the custom implementation */
