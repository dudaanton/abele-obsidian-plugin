/**
 * The Automations tab of the scripts page: one card per rule — when it runs, on which notes,
 * which script with which values, how often at most, and whether changes arriving from other
 * devices count.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ScriptsSettings from '@/components/settings/ScriptsSettings.vue'
import AutomationsEditor from '@/components/settings/scripts/AutomationsEditor.vue'
import Card from '@/components/obsidian/Card.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Button from '@/components/obsidian/Button.vue'
import Input from '@/components/obsidian/Input.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Tabs from '@/components/obsidian/Tabs.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { pickScript } from '@/helpers/suggesters/RunnablePicker'
import { normalizeRule, type AutomationRule } from '@/automations/types'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

vi.mock('@/helpers/suggesters/RunnablePicker', () => ({
  pickScript: vi.fn(),
  pickCommand: vi.fn(),
  listCommands: () => [],
}))

const logScript: ParsedScript = {
  path: 'Scripts/log.js',
  meta: {
    name: 'Log',
    description: 'Appends a line to the log.',
    params: [
      { name: 'line', type: 'string', required: true, description: 'What to write' },
      { name: 'note', type: 'string', required: false, description: '', default: 'Log.md' },
    ],
  },
  code: '',
  commandId: 'abele-script-log',
}

const STUBS = { Search: true, Dropdown: true }
let config: AbeleConfig

const rule = (overrides: Partial<AutomationRule> = {}) =>
  normalizeRule({
    id: 'a1',
    name: 'Log done',
    event: 'task.completed',
    scriptName: 'Log',
    ...overrides,
  })

const open = () => mount(AutomationsEditor, { global: { stubs: STUBS } })
const settingNamed = (wrapper: VueWrapper, name: string) =>
  wrapper.findAllComponents(Setting).find((s) => s.props('name') === name)
const inputOf = (wrapper: VueWrapper, name: string) =>
  settingNamed(wrapper, name)!.findComponent(Input)

beforeEach(() => {
  const app = useVault([]) as unknown as { vault: { getName: () => string } }
  app.vault.getName = () => 'Vault'
  config = AbeleConfig.getInstance()
  config.ai = { ...config.ai, enabled: true, scriptsEnabled: true, scriptsFolder: 'Scripts' }
  config.automations = []
  config.headerButtons = []
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  ScriptService.getInstance().scriptList.value = [logScript]
  vi.spyOn(ScriptService.getInstance(), 'getAll').mockReturnValue([logScript])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the scripts page', () => {
  it('has an Automations tab beside the others', async () => {
    const wrapper = mount(ScriptsSettings, { global: { stubs: STUBS } })
    const tabs = wrapper.findComponent(Tabs)

    expect(tabs.props('tabs').map((t: { label: string }) => t.label)).toContain('Automations')
    tabs.vm.$emit('update:modelValue', 'automations')
    await nextTick()
    expect(wrapper.findComponent(AutomationsEditor).exists()).toBe(true)
  })
})

describe('the automations', () => {
  it('say there are none yet', () => {
    expect(open().findComponent(EmptyState).exists()).toBe(true)
  })

  it('adds one that waits for a completed task, on, at most every 5 seconds a note', async () => {
    const wrapper = open()

    await wrapper
      .findAllComponents(Button)
      .find((b) => b.props('text') === 'Add automation')!
      .trigger('click')

    expect(config.automations).toHaveLength(1)
    expect(config.automations[0]).toMatchObject({
      enabled: true,
      event: 'task.completed',
      throttleSeconds: 5,
      includeExternal: false,
      scriptName: '',
    })
    const card = wrapper.findComponent(Card)
    expect(card.props('title')).toBe('Task completed')
    expect(card.props('subtitle')).toBe('No script chosen yet')
  })

  it('shows each rule by its name, event and script', () => {
    config.automations = [rule()]
    const card = open().findComponent(Card)

    expect(card.props('title')).toBe('Log done')
    expect(card.props('subtitle')).toBe('Task completed → Log')
  })

  it('changes the event, and offers note types only for note events', async () => {
    config.automations = [rule()]
    const wrapper = open()
    expect(settingNamed(wrapper, 'Note types')).toBeUndefined()

    wrapper.findComponent(Dropdown).vm.$emit('update:model-value', 'note.changed')
    await nextTick()

    expect(config.automations[0].event).toBe('note.changed')
    expect(settingNamed(wrapper, 'Note types')).toBeDefined()
    await inputOf(wrapper, 'Note types').vm.$emit('update:model-value', 'movie, book ')
    expect(config.automations[0].noteTypes).toEqual(['movie', 'book'])
  })

  it('filters by folder and by a property', async () => {
    config.automations = [rule()]
    const wrapper = open()

    await inputOf(wrapper, 'Folders').vm.$emit('update:model-value', 'Tasks, Work/Tasks')
    await inputOf(wrapper, 'Property').vm.$emit('update:model-value', 'area')
    await inputOf(wrapper, 'Equals').vm.$emit('update:model-value', 'home')

    expect(config.automations[0]).toMatchObject({
      folders: ['Tasks', 'Work/Tasks'],
      property: 'area',
      value: 'home',
    })
  })

  it('picks a script and asks for the values its parameters take', async () => {
    config.automations = [rule({ scriptName: '', params: { stale: 'x' } })]
    vi.mocked(pickScript).mockResolvedValue(logScript)
    const wrapper = open()

    await settingNamed(wrapper, 'Script')!.findComponent(Button).trigger('click')
    await nextTick()
    await nextTick()

    expect(config.automations[0].scriptName).toBe('Log')
    expect(config.automations[0].params).toEqual({})
    await inputOf(wrapper, 'line').vm.$emit('update:model-value', '{{title}} done')
    expect(config.automations[0].params).toEqual({ line: '{{title}} done' })
    expect(inputOf(wrapper, 'note').props('placeholder')).toBe('Log.md')
  })

  it('takes how often it may run as whole seconds, and 0 for every time', async () => {
    config.automations = [rule()]
    const wrapper = open()

    await inputOf(wrapper, 'At most every (seconds)').vm.$emit('update:model-value', '30')
    expect(config.automations[0].throttleSeconds).toBe(30)
    await inputOf(wrapper, 'At most every (seconds)').vm.$emit('update:model-value', 'x')
    expect(config.automations[0].throttleSeconds).toBe(0)
  })

  it('switches on changes from other devices only when asked', async () => {
    config.automations = [rule()]
    const wrapper = open()

    await settingNamed(wrapper, 'Also for changes from other devices')!
      .findComponent(Checkbox)
      .trigger('click')

    expect(config.automations[0].includeExternal).toBe(true)
  })

  it('switches a rule off, and marks it', async () => {
    config.automations = [rule()]
    const wrapper = open()

    await settingNamed(wrapper, 'Run this automation')!.findComponent(Checkbox).trigger('click')

    expect(config.automations[0].enabled).toBe(false)
    expect(wrapper.findComponent(Card).text()).toContain('Off')
  })

  it('asks before deleting one', async () => {
    config.automations = [rule()]
    const wrapper = open()

    await wrapper
      .findAllComponents(Icon)
      .find((i) => i.props('tooltip') === 'Delete this automation')!
      .trigger('click')
    expect(config.automations).toHaveLength(1)

    const confirm = wrapper.findComponent(ConfirmModal)
    expect(confirm.props('message')).toContain('Log done')
    confirm.vm.$emit('confirm')
    await nextTick()

    expect(config.automations).toHaveLength(0)
  })
})
