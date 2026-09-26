/**
 * Startup scripts in the settings: the power button on a script's library card that puts it on
 * the list or takes it off, and the Startup tab where the list is put in order, each script told
 * which devices it runs on, and all of them skipped with one switch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ScriptsSettings from '@/components/settings/ScriptsSettings.vue'
import ScriptLibrary from '@/components/settings/scripts/ScriptLibrary.vue'
import StartupScriptsEditor from '@/components/settings/scripts/StartupScriptsEditor.vue'
import Card from '@/components/obsidian/Card.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Button from '@/components/obsidian/Button.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Tabs from '@/components/obsidian/Tabs.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

vi.mock('@/helpers/suggesters/RunnablePicker', () => ({
  pickScript: vi.fn(),
  pickCommand: vi.fn(),
  listCommands: () => [],
}))

const script = (name: string, extra: Partial<ParsedScript['meta']> = {}): ParsedScript => ({
  path: `Scripts/${name.toLowerCase()}.js`,
  meta: { name, description: `${name} does things.`, params: [], ...extra },
  code: '',
  commandId: `abele-script-${name.toLowerCase()}`,
})

const inbox = script('Inbox')
const weather = script('Weather', { startup: 'mobile' })
const plain = script('Plain')

const STUBS = { Search: true }

let config: AbeleConfig

beforeEach(() => {
  const app = useVault([]) as unknown as { vault: { getName: () => string } }
  app.vault.getName = () => 'Vault'
  config = AbeleConfig.getInstance()
  config.ai = {
    ...config.ai,
    scriptsEnabled: true,
    scriptsFolder: 'Scripts',
    startupScripts: [],
    startupScriptsPaused: false,
  }
  config.headerButtons = []
  // The real save is what tells the screens the settings changed.
  vi.spyOn(config, 'saveSettings').mockImplementation(async () => {
    config.version.value++
  })
  ScriptService.getInstance().scriptList.value = [inbox, weather, plain]
  vi.spyOn(ScriptService.getInstance(), 'getAll').mockReturnValue([inbox, weather, plain])
})

afterEach(() => {
  vi.restoreAllMocks()
})

enableAutoUnmount(afterEach)

const cardTitled = (wrapper: VueWrapper, title: string) => {
  const card = wrapper.findAllComponents(Card).find((c) => c.props('title') === title)
  if (!card) throw new Error(`No card titled "${title}"`)
  return card
}
const powerOf = (wrapper: VueWrapper, title: string) =>
  cardTitled(wrapper, title).find('.abele-script-startup-toggle')

describe('the library card', () => {
  const open = () => mount(ScriptLibrary, { global: { stubs: STUBS } })

  it('puts a script on the startup list and takes it off again', async () => {
    const wrapper = open()

    await powerOf(wrapper, 'Inbox').trigger('click')
    await nextTick()
    expect(config.ai.startupScripts).toEqual([{ script: 'Inbox', devices: 'both' }])
    expect(cardTitled(wrapper, 'Inbox').text()).toContain('Startup')

    await powerOf(wrapper, 'Inbox').trigger('click')
    await nextTick()
    expect(config.ai.startupScripts).toEqual([])
    expect(cardTitled(wrapper, 'Inbox').text()).not.toContain('Startup')
  })

  it('shows one run at startup by its header line, and leaves the button alone', async () => {
    const wrapper = open()

    expect(cardTitled(wrapper, 'Weather').text()).toContain('Startup')
    await powerOf(wrapper, 'Weather').trigger('click')
    expect(config.ai.startupScripts).toEqual([])
  })
})

describe('the startup tab', () => {
  const open = () => mount(StartupScriptsEditor, { global: { stubs: STUBS } })
  const entries = (wrapper: VueWrapper) =>
    wrapper
      .findAllComponents(Setting)
      .filter((s) => s.classes('abele-startup-scripts__entry'))
      .map((s) => s.attributes('data-script'))
  const iconIn = (wrapper: VueWrapper, name: string, icon: string) =>
    wrapper
      .findAllComponents(Setting)
      .find((s) => s.attributes('data-script') === name)!
      .findAllComponents(Icon)
      .find((i) => i.props('icon') === icon)!

  it('lists the chosen scripts in their order, then those put there by their header', () => {
    config.ai = {
      ...config.ai,
      startupScripts: [
        { script: 'Plain', devices: 'both' },
        { script: 'Inbox', devices: 'desktop' },
      ],
    }
    const wrapper = open()

    expect(entries(wrapper)).toEqual(['Plain', 'Inbox'])
    const headed = wrapper
      .findAllComponents(Setting)
      .filter((s) => s.classes('abele-startup-scripts__headed'))
    expect(headed.map((s) => s.attributes('data-script'))).toEqual(['Weather'])
  })

  it('moves a script later, and keeps that order', async () => {
    config.ai = {
      ...config.ai,
      startupScripts: [
        { script: 'Plain', devices: 'both' },
        { script: 'Inbox', devices: 'both' },
      ],
    }
    const wrapper = open()

    await iconIn(wrapper, 'Plain', 'arrow-down').trigger('click')
    await nextTick()

    expect(config.ai.startupScripts.map((s) => s.script)).toEqual(['Inbox', 'Plain'])
    expect(entries(wrapper)).toEqual(['Inbox', 'Plain'])
  })

  it('tells a script which devices it runs on', async () => {
    config.ai = { ...config.ai, startupScripts: [{ script: 'Plain', devices: 'both' }] }
    const wrapper = open()

    await wrapper.findComponent(Dropdown).vm.$emit('update:model-value', 'mobile')

    expect(config.ai.startupScripts).toEqual([{ script: 'Plain', devices: 'mobile' }])
  })

  it('takes a script off the list', async () => {
    config.ai = { ...config.ai, startupScripts: [{ script: 'Plain', devices: 'both' }] }
    const wrapper = open()

    await iconIn(wrapper, 'Plain', 'trash').trigger('click')

    expect(config.ai.startupScripts).toEqual([])
  })

  it('adds one run by its header to the list, to give it a place', async () => {
    const wrapper = open()

    await wrapper
      .findAllComponents(Button)
      .find((b) => b.props('text') === 'Add to the list')!
      .trigger('click')

    expect(config.ai.startupScripts).toEqual([{ script: 'Weather', devices: 'mobile' }])
  })

  it('has a switch that skips every startup script', async () => {
    const wrapper = open()

    await wrapper.findComponent(Checkbox).vm.$emit('toggle')

    expect(config.ai.startupScriptsPaused).toBe(true)
  })
})

describe('the scripts page', () => {
  it('has a tab for the startup scripts', async () => {
    const wrapper = mount(ScriptsSettings, { global: { stubs: STUBS } })
    const tabs = wrapper.findComponent(Tabs)

    expect(tabs.props('tabs').map((t: { id: string }) => t.id)).toContain('startup')
    await tabs.vm.$emit('update:modelValue', 'startup')
    await nextTick()
    expect(wrapper.findComponent(StartupScriptsEditor).exists()).toBe(true)
  })
})
