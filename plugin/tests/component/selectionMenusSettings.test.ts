import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ScriptsSettings from '@/components/settings/ScriptsSettings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import { ScriptService } from '@/scripting/ScriptService'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import { pickScript } from '@/helpers/suggesters/RunnablePicker'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

vi.mock('@/helpers/suggesters/RunnablePicker', () => ({ pickScript: vi.fn() }))
const parsed = (header: string): ParsedScript => ({
  path: 'Scripts/sample.js',
  code: '',
  commandId: '',
  meta: parseScriptHeader(header)!,
})
const all = [
  parsed('// @name Book example\n// @book'),
  parsed('// @name Chat example\n// @chat-selection'),
  parsed('// @name Plain'),
]
let config: AbeleConfig
let form: VueWrapper
beforeEach(() => {
  useVault([])
  config = AbeleConfig.getInstance()
  config.headerButtons = []
  config.ai = { ...DEFAULT_AI_SETTINGS, scriptsEnabled: true, chatSelectionScripts: [] }
  config.reader = {
    ...DEFAULT_READER_SETTINGS,
    selectionScripts: [{ script: 'Plain', name: 'Book label', icon: 'book' }],
  }
  ScriptService.getInstance().scriptList.value = all
  vi.spyOn(ScriptService.getInstance(), 'getAll').mockReturnValue(all)
  vi.spyOn(config, 'saveSettings').mockImplementation(async () => {
    config.version.value++
  })
  vi.useFakeTimers()
})
afterEach(async () => {
  await vi.runAllTimersAsync()
  form?.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const button = (text: string) => form.findAll('button').find((b) => b.text() === text)!
const tab = async (text: string) => {
  const found = form.findAll('[role="tab"]').find((t) => t.text() === text)
  expect(found, `tab ${text}`).toBeDefined()
  await found!.trigger('click')
  await flushPromises()
}
const entries = () => form.findAll('.abele-selection-scripts-settings__entry')

describe('selection menu settings', () => {
  it('exposes both surfaces and adds the same library script independently without copying overrides', async () => {
    form = mount(ScriptsSettings)
    await tab('Selection menus')
    expect(entries().map((e) => e.attributes('data-script'))).toEqual(['Plain'])
    await tab('Chats')
    expect(entries()).toHaveLength(0)
    expect(
      form
        .findAll('.abele-selection-scripts-settings__headed')
        .map((e) => e.attributes('data-script'))
    ).toEqual(['Chat example'])
    expect(form.text()).not.toContain('Book example')
    vi.mocked(pickScript).mockResolvedValue(all[2])
    await button('Add a script').trigger('click')
    await flushPromises()
    expect(config.ai.chatSelectionScripts).toEqual([{ script: 'Plain', name: '', icon: '' }])
    expect(config.reader.selectionScripts).toEqual([
      { script: 'Plain', name: 'Book label', icon: 'book' },
    ])
    await entries()[0].find('input').setValue('Chat label')
    await vi.runAllTimersAsync()
    expect(config.ai.chatSelectionScripts[0].name).toBe('Chat label')
    await tab('Books')
    expect(entries()[0].find('input').element.value).toBe('Book label')
    await tab('Chats')
    expect(entries()[0].find('input').element.value).toBe('Chat label')
  })

  it('customizes a header script, reorders, changes an icon, and unpins without deleting the script', async () => {
    form = mount(ScriptsSettings)
    await tab('Selection menus')
    await tab('Chats')
    await button('Add to the list').trigger('click')
    await flushPromises()
    vi.mocked(pickScript).mockResolvedValue(all[2])
    await button('Add a script').trigger('click')
    await flushPromises()
    await entries()[1].find('[aria-label="Move it up the menu"]').trigger('click')
    await flushPromises()
    expect(config.ai.chatSelectionScripts.map((e) => e.script)).toEqual(['Plain', 'Chat example'])
    await entries()[0].find('[aria-label="Choose the icon it has on the bar"]').trigger('click')
    const picker = form.findComponent({ name: 'IconPicker' })
    expect(picker.exists()).toBe(true)
    picker.vm.$emit('choose', 'star')
    await flushPromises()
    expect(config.ai.chatSelectionScripts[0].icon).toBe('star')
    await entries()[0].find('[aria-label="Take it off the menu"]').trigger('click')
    const confirm = form.findComponent({ name: 'ConfirmModal' })
    expect(confirm.props('message')).toContain('chat')
    confirm.vm.$emit('confirm')
    await flushPromises()
    expect(config.ai.chatSelectionScripts.map((e) => e.script)).toEqual(['Chat example'])
    expect(ScriptService.getInstance().scriptList.value).toHaveLength(3)
    expect(config.reader.selectionScripts[0].icon).toBe('book')
  })
})
