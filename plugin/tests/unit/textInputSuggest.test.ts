/**
 * Where a text-input suggester hangs its popup.
 *
 * Since Obsidian 1.13 the settings pane can open in a window of its own. A popup built with
 * the global `createDiv` and appended to `app.dom.appContainerEl` then lands in the *main*
 * window — which is how the note picker in the agent editor ended up floating over the note
 * the user was reading, in a different window from the field they were typing into.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { App } from 'obsidian'

vi.mock('@popperjs/core', () => ({
  // Positioning needs a layout engine; happy-dom has none, and none of this is about position.
  createPopper: () => ({ destroy: () => undefined, update: () => undefined }),
}))

const { TextInputSuggest } = await import('@/helpers/suggesters/suggest')

class PathSuggest extends TextInputSuggest<string> {
  getSuggestions(): string[] {
    return ['Notes/One.md', 'Notes/Two.md']
  }
  renderSuggestion(item: string, el: HTMLElement): void {
    el.textContent = item
  }
  selectSuggestion(): void {
    // Selection is not what these tests are about.
  }
}

let appContainerEl: HTMLElement
let app: App

beforeEach(() => {
  document.body.innerHTML = ''
  appContainerEl = document.createElement('div')
  appContainerEl.classList.add('app-container')
  document.body.appendChild(appContainerEl)

  app = {
    dom: { appContainerEl },
    keymap: { pushScope: vi.fn(), popScope: vi.fn() },
  } as unknown as App
})

function inputIn(doc: Document): HTMLInputElement {
  const input = doc.createElement('input')
  input.type = 'text'
  doc.body.appendChild(input)
  return input
}

/** Stands in for the settings window: a second document, as a separate window would be. */
function otherWindowDocument(): Document {
  return document.implementation.createHTMLDocument('settings')
}

describe('a suggester on an input in the main window', () => {
  it('hangs its popup in the app container, as Obsidian does', () => {
    const input = inputIn(document)
    const suggest = new PathSuggest(app, input)

    suggest.onInputChanged()

    expect(appContainerEl.querySelector('.suggestion-container')).not.toBeNull()
  })
})

describe('a suggester on an input in another window', () => {
  it('builds the popup in that window, not the main one', () => {
    const doc = otherWindowDocument()
    const input = inputIn(doc)

    const suggest = new PathSuggest(app, input)
    suggest.onInputChanged()

    const popup = doc.querySelector('.suggestion-container')
    expect(popup).not.toBeNull()
    expect(popup?.ownerDocument).toBe(doc)
  })

  it('leaves nothing behind in the main window', () => {
    const doc = otherWindowDocument()
    const input = inputIn(doc)

    new PathSuggest(app, input).onInputChanged()

    expect(document.querySelector('.suggestion-container')).toBeNull()
    expect(appContainerEl.children).toHaveLength(0)
  })

  it('shows the suggestions it was given', () => {
    const doc = otherWindowDocument()
    const input = inputIn(doc)

    new PathSuggest(app, input).onInputChanged()

    const items = [...doc.querySelectorAll('.suggestion-item')].map((el) => el.textContent)
    expect(items).toEqual(['Notes/One.md', 'Notes/Two.md'])
  })

  it('takes the popup down again on close', () => {
    const doc = otherWindowDocument()
    const input = inputIn(doc)
    const suggest = new PathSuggest(app, input)
    suggest.onInputChanged()

    suggest.close()

    expect(doc.querySelector('.suggestion-container')).toBeNull()
  })
})
