/**
 * The book menu as set in Settings → Book reader (`BookScriptsSettings.vue`): the scripts offered
 * on words selected in a book, added from a search, ordered, taken off; the ones on it by their
 * header listed after.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import BookScriptsSettings from '@/components/reader/BookScriptsSettings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import { pickScript } from '@/helpers/suggesters/RunnablePicker'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

vi.mock('@/helpers/suggesters/RunnablePicker', () => ({
  pickScript: vi.fn(),
}))

const parsed = (header: string): ParsedScript => ({
  path: 'Scripts/x.js',
  code: '',
  commandId: '',
  meta: parseScriptHeader(header)!,
})
const ALL = [
  parsed('// @name Translate\n// @icon languages'),
  parsed('// @name Word card\n// @book'),
  parsed('// @name Plain'),
]

let config: AbeleConfig
beforeEach(() => {
  useVault([])
  config = AbeleConfig.getInstance()
  config.reader = { ...DEFAULT_READER_SETTINGS, selectionScripts: [] }
  vi.spyOn(config, 'saveSettings').mockImplementation(async () => {
    config.version.value++
  })
  ScriptService.getInstance().scriptList.value = ALL
  vi.spyOn(ScriptService.getInstance(), 'getAll').mockReturnValue(ALL)
})
afterEach(() => vi.restoreAllMocks())

const listed = () => config.reader.selectionScripts.map((c) => c.script)
const entries = (form: VueWrapper) =>
  form.findAll('.abele-book-scripts-settings__entry').map((r) => r.attributes('data-script'))
const headed = (form: VueWrapper) =>
  form.findAll('.abele-book-scripts-settings__headed').map((r) => r.attributes('data-script'))
const button = (form: VueWrapper, text: string) =>
  form.findAll('button').find((b) => b.text() === text)!

describe('the scripts on words selected in a book, in the settings', () => {
  it('lists a book header script after the chosen ones, and adds one from a search', async () => {
    const form = mount(BookScriptsSettings)
    expect(entries(form)).toEqual([])
    expect(headed(form)).toEqual(['Word card'])

    vi.mocked(pickScript).mockResolvedValue(ALL[0])
    await button(form, 'Add a script').trigger('click')
    await flushPromises()
    expect(listed()).toEqual(['Translate'])
    // The search offers only what is not on the list yet.
    expect(vi.mocked(pickScript).mock.calls[0][1].map((s) => s.meta.name)).toEqual([
      'Translate',
      'Word card',
      'Plain',
    ])
    expect(entries(form)).toEqual(['Translate'])
  })

  it('gives a book header script a place in the list, and moves entries', async () => {
    config.reader = {
      ...config.reader,
      selectionScripts: [{ script: 'Plain', name: '', icon: '' }],
    }
    const form = mount(BookScriptsSettings)
    await form
      .find('.abele-book-scripts-settings__headed')
      .findAll('button')
      .find((b) => b.text() === 'Add to the list')!
      .trigger('click')
    await flushPromises()
    expect(listed()).toEqual(['Plain', 'Word card'])
    expect(headed(form)).toEqual([])

    await form
      .findAll('.abele-book-scripts-settings__entry')[1]
      .find('[aria-label="Move it up the menu"]')
      .trigger('click')
    await flushPromises()
    expect(listed()).toEqual(['Word card', 'Plain'])
    expect(entries(form)).toEqual(['Word card', 'Plain'])
  })

  it('names an entry as typed', async () => {
    config.reader = {
      ...config.reader,
      selectionScripts: [{ script: 'Plain', name: '', icon: '' }],
    }
    const form = mount(BookScriptsSettings)
    await form.find('.abele-book-scripts-settings__entry input').setValue('Card')
    expect(config.reader.selectionScripts[0].name).toBe('Card')
  })
})
