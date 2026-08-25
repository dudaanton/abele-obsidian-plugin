/**
 * What the path pickers offer, and what taking one does.
 *
 * These used to assert where the popup was hung, back when the plugin built its own with
 * Popper — including the guard against a picker in the settings window putting its list in the
 * main one. That code is gone: the pickers now extend Obsidian's `AbstractInputSuggest`, which
 * owns the popup and the window it belongs to. Testing Obsidian's popup would be testing
 * Obsidian, so what is left here is the part the plugin still decides.
 *
 * The field-writing case matters most. The Vue components observe these fields through
 * `SearchComponent.onChange`, which listens for an `input` event — so a picker that sets
 * `value` without firing the event would look right on screen and silently save nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { App } from 'obsidian'
import { TFile, TFolder } from 'obsidian'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'

let app: App

function folder(path: string): TFolder {
  const f = new TFolder()
  f.path = path
  f.name = path.split('/').pop() ?? path
  return f
}

function file(path: string): TFile {
  const f = new TFile()
  f.path = path
  f.name = path.split('/').pop() ?? path
  f.extension = path.split('.').pop() ?? ''
  return f
}

const tree = [folder('Notes'), folder('Notes/Projects'), folder('Archive'), file('Notes/One.md')]

beforeEach(() => {
  document.body.innerHTML = ''
  app = { vault: { getAllLoadedFiles: () => tree } } as unknown as App
})

function inputWithSuggest(): { input: HTMLInputElement; suggest: FolderSuggest } {
  const input = document.createElement('input')
  document.body.appendChild(input)
  return { input, suggest: new FolderSuggest(app, input) }
}

describe('what a folder picker offers', () => {
  it('offers folders and not files', () => {
    const { suggest } = inputWithSuggest()
    expect(suggest.getSuggestions('').map((f) => f.path)).toEqual([
      'Notes',
      'Notes/Projects',
      'Archive',
    ])
  })

  it('narrows to what the query matches, anywhere in the path', () => {
    const { suggest } = inputWithSuggest()
    expect(suggest.getSuggestions('proj').map((f) => f.path)).toEqual(['Notes/Projects'])
  })

  it('ignores case', () => {
    const { suggest } = inputWithSuggest()
    expect(suggest.getSuggestions('ARCH').map((f) => f.path)).toEqual(['Archive'])
  })

  it('offers nothing when nothing matches', () => {
    const { suggest } = inputWithSuggest()
    expect(suggest.getSuggestions('nothing-like-this')).toEqual([])
  })

  it('draws a suggestion as its path', () => {
    const { suggest } = inputWithSuggest()
    const el = document.createElement('div')
    suggest.renderSuggestion(folder('Notes/Projects'), el)
    expect(el.textContent).toBe('Notes/Projects')
  })
})

describe('taking a suggestion', () => {
  it('writes the path into the field', () => {
    const { input, suggest } = inputWithSuggest()
    suggest.selectSuggestion(folder('Notes/Projects'))
    expect(input.value).toBe('Notes/Projects')
  })

  it('fires an input event, which is how the settings field hears about it', () => {
    const { input, suggest } = inputWithSuggest()
    const heard = vi.fn()
    input.addEventListener('input', heard)

    suggest.selectSuggestion(folder('Notes/Projects'))

    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('closes the list', () => {
    const { suggest } = inputWithSuggest()
    suggest.selectSuggestion(folder('Archive'))
    expect((suggest as unknown as { closed: boolean }).closed).toBe(true)
  })
})

describe('refreshing without taking anything', () => {
  it('re-runs the query and leaves the field alone', () => {
    const { input, suggest } = inputWithSuggest()
    input.value = 'proj'
    const heard = vi.fn()
    input.addEventListener('input', heard)

    suggest.refresh()

    expect(heard).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('proj')
  })
})
