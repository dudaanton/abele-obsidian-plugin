/**
 * The person's own scripts on words selected in a book: the list kept in the reader settings,
 * what the bar offers from it and from the book header, and pinning from the picker.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  bookMenu,
  bookMenuPlace,
  bookMenuScriptsFrom,
  movedBookScript,
  withBookScript,
  withoutBookScript,
} from '@/scripting/bookMenuScripts'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import { readerSettingsFrom, DEFAULT_READER_SETTINGS } from '@/reader/settings'
import type { ParsedScript } from '@/scripting/types'
import { BookScriptPicker } from '@/scripting/runFromBook'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

const parsed = (header: string): ParsedScript => ({
  path: 'Scripts/x.js',
  code: '',
  commandId: '',
  meta: parseScriptHeader(header)!,
})

const ALL = [
  parsed('// @name Translate\n// @icon languages'),
  parsed('// @name Word card\n// @icon book\n// @book'),
  parsed('// @name Anki\n// @book'),
  parsed('// @name Plain'),
]

describe('the book menu list', () => {
  it('is kept whole: nameless and repeated entries dropped, missing fields empty', () => {
    expect(
      bookMenuScriptsFrom([
        { script: 'Translate', name: 'Tr', icon: 'globe' },
        { script: 'Translate' },
        { script: '  ' },
        null,
        'Plain',
        { script: 'Plain' },
      ])
    ).toEqual([
      { script: 'Translate', name: 'Tr', icon: 'globe' },
      { script: 'Plain', name: '', icon: '' },
    ])
    expect(bookMenuScriptsFrom(undefined)).toEqual([])
  })

  it('lives in the reader settings, empty by default', () => {
    expect(DEFAULT_READER_SETTINGS.selectionScripts).toEqual([])
    expect(
      readerSettingsFrom({ selectionScripts: [{ script: 'Plain', name: '', icon: '' }] })
        .selectionScripts
    ).toEqual([{ script: 'Plain', name: '', icon: '' }])
    expect(readerSettingsFrom({}).selectionScripts).toEqual([])
  })
})

describe('what the bar offers', () => {
  it('the chosen scripts in their order, named and drawn as chosen, then the book header ones by name', () => {
    const chosen = [
      { script: 'Plain', name: '', icon: '' },
      { script: 'Translate', name: 'To Russian', icon: '' },
      { script: 'Gone', name: '', icon: '' },
    ]
    expect(bookMenu(ALL, chosen)).toEqual([
      { script: 'Plain', label: 'Plain', icon: 'scroll-text', by: 'setting' },
      { script: 'Translate', label: 'To Russian', icon: 'languages', by: 'setting' },
      { script: 'Anki', label: 'Anki', icon: 'scroll-text', by: 'header' },
      { script: 'Word card', label: 'Word card', icon: 'book', by: 'header' },
    ])
  })

  it('gives a book header script chosen in the list its place there, once', () => {
    const items = bookMenu(ALL, [{ script: 'Word card', name: '', icon: 'star' }])
    expect(items.map((i) => [i.script, i.by, i.icon])).toEqual([
      ['Word card', 'setting', 'star'],
      ['Anki', 'header', 'scroll-text'],
    ])
  })

  it('knows where a script stands', () => {
    const chosen = [{ script: 'Plain', name: '', icon: '' }]
    expect(bookMenuPlace(ALL[3], chosen)).toBe('setting')
    expect(bookMenuPlace(ALL[2], chosen)).toBe('header')
    expect(bookMenuPlace(ALL[0], chosen)).toBeNull()
  })
})

describe('changing the list', () => {
  const list = [
    { script: 'A', name: '', icon: '' },
    { script: 'B', name: '', icon: '' },
  ]

  it('adds at the end, once, and takes out', () => {
    expect(withBookScript(list, 'C').map((c) => c.script)).toEqual(['A', 'B', 'C'])
    expect(withBookScript(list, 'A')).toBe(list)
    expect(withoutBookScript(list, 'A').map((c) => c.script)).toEqual(['B'])
  })

  it('moves one up or down, and not past either end', () => {
    expect(movedBookScript(list, 1, -1).map((c) => c.script)).toEqual(['B', 'A'])
    expect(movedBookScript(list, 0, -1)).toBe(list)
    expect(movedBookScript(list, 1, 1)).toBe(list)
  })
})

describe('the list to pick a script from', () => {
  const app = {} as never
  let saved = 0

  beforeEach(() => {
    useVault([])
    saved = 0
    const config = AbeleConfig.getInstance()
    config.reader = {
      ...DEFAULT_READER_SETTINGS,
      selectionScripts: [{ script: 'Plain', name: '', icon: '' }],
    }
    vi.spyOn(config, 'saveSettings').mockImplementation(async () => {
      saved++
    })
  })

  const row = (picker: BookScriptPicker, script: ParsedScript) => {
    const el = document.createElement('div')
    picker.renderSuggestion({ item: script, match: { score: 0, matches: [] } }, el)
    return el.querySelector<HTMLElement>('.abele-book-script-pin')!
  }

  it("has the book menu's scripts first, in its order, then the rest by name", () => {
    const picker = new BookScriptPicker(app, ALL, () => {})
    expect(picker.getItems().map((s) => s.meta.name)).toEqual([
      'Plain',
      'Anki',
      'Word card',
      'Translate',
    ])
  })

  it('pins a script to the book menu and unpins it, without running it', async () => {
    const ran: string[] = []
    const picker = new BookScriptPicker(app, ALL, (s) => ran.push(s.meta.name))
    const pin = row(picker, ALL[0])
    expect(pin.dataset.place).toBe('')
    pin.click()
    await vi.waitFor(() => expect(pin.dataset.place).toBe('setting'))
    expect(
      readerSettingsFrom(AbeleConfig.getInstance().reader).selectionScripts.map((c) => c.script)
    ).toEqual(['Plain', 'Translate'])
    pin.click()
    await vi.waitFor(() => expect(pin.dataset.place).toBe(''))
    expect(
      readerSettingsFrom(AbeleConfig.getInstance().reader).selectionScripts.map((c) => c.script)
    ).toEqual(['Plain'])
    expect(saved).toBe(2)
    expect(ran).toEqual([])
  })

  it('says a book header script is on the menu by its header, and leaves it be', async () => {
    const picker = new BookScriptPicker(app, ALL, () => {})
    const pin = row(picker, ALL[1])
    expect(pin.dataset.place).toBe('header')
    pin.click()
    await Promise.resolve()
    expect(saved).toBe(0)
  })
})
