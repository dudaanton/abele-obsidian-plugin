/**
 * The header button form: its icon, chosen from a grid, and the properties a note must have.
 *
 * Which buttons a note then shows is `tests/unit/headerButtons.test.ts`; the script picker of
 * the same form is in `settingsPickers.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import HeaderButtonsEditor from '@/components/settings/scripts/HeaderButtonsEditor.vue'
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Input from '@/components/obsidian/Input.vue'
import Badge from '@/components/obsidian/Badge.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import IconPicker from '@/components/obsidian/IconPicker.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { useVault } from '../helpers/testEnv'

let config: AbeleConfig
const mounted: Array<ReturnType<typeof mount>> = []

beforeEach(() => {
  useVault([
    { path: 'Tasks/Water plants.md', frontmatter: { type: 'task' }, content: '' },
    { path: 'Films/The Third Man.md', frontmatter: { type: 'movie' }, content: '' },
  ])
  config = AbeleConfig.getInstance()
  config.ai = { ...config.ai, scriptsEnabled: true, scriptsFolder: 'Scripts' }
  config.headerButtons = [
    {
      id: 'b1',
      name: 'Fetch',
      icon: 'download',
      noteTypes: ['movie'],
      scriptName: 'Fetch',
      params: {},
      conditions: [],
      conditionMode: 'all',
    },
  ]
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  ScriptService.getInstance().scriptList.value = []
  vi.spyOn(ScriptService.getInstance(), 'getAll').mockReturnValue([])
})

// Unmounted while `saveSettings` is still the spy: the form holds its write back for half a
// second and flushes it on unmount.
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

function open() {
  const wrapper = mount(HeaderButtonsEditor, { global: { stubs: { Search: true } } })
  mounted.push(wrapper)
  return wrapper
}

function buttonWith(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAllComponents(Button).find((b) => b.props('text') === text)
  if (!button) {
    const labels = wrapper.findAllComponents(Button).map((b) => b.props('text'))
    throw new Error(`No button labelled "${text}". Present: ${labels.join(', ')}`)
  }
  return button
}

describe('the icon of a header button', () => {
  it('is shown as itself, and pressing it opens the grid on it', async () => {
    const wrapper = open()

    const choose = buttonWith(wrapper, 'download')
    expect(choose.props('icon')).toBe('download')
    await choose.trigger('click')

    const picker = wrapper.findComponent(IconPicker)
    expect(picker.exists()).toBe(true)
    expect(picker.props('current')).toBe('download')
  })

  it('is what was picked, saved, and the grid closes', async () => {
    const wrapper = open()
    await buttonWith(wrapper, 'download').trigger('click')

    wrapper.findComponent(IconPicker).vm.$emit('choose', 'calendar')
    await nextTick()

    expect(config.headerButtons[0].icon).toBe('calendar')
    expect(wrapper.findComponent(IconPicker).exists()).toBe(false)
    expect(buttonWith(wrapper, 'calendar').exists()).toBe(true)
  })

  it('stays as it was when the grid is closed without a choice', async () => {
    const wrapper = open()
    await buttonWith(wrapper, 'download').trigger('click')

    wrapper.findComponent(IconPicker).vm.$emit('close')
    await nextTick()

    expect(config.headerButtons[0].icon).toBe('download')
    expect(wrapper.findComponent(IconPicker).exists()).toBe(false)
  })
})

describe('the properties a header button asks for', () => {
  const conditionInputs = (wrapper: ReturnType<typeof mount>) =>
    wrapper
      .findAllComponents(Input)
      .filter((i) => i.classes().includes('abele-header-buttons__property'))
  const valueInputs = (wrapper: ReturnType<typeof mount>) =>
    wrapper
      .findAllComponents(Input)
      .filter((i) => i.classes().includes('abele-header-buttons__value'))
  const testDropdowns = (wrapper: ReturnType<typeof mount>) =>
    wrapper
      .findAllComponents(Dropdown)
      .filter((d) => d.classes().includes('abele-header-buttons__test'))

  it('start with none, and one is added by a button', async () => {
    const wrapper = open()
    expect(conditionInputs(wrapper)).toHaveLength(0)

    await buttonWith(wrapper, 'Add condition').trigger('click')

    expect(conditionInputs(wrapper)).toHaveLength(1)
    expect(config.headerButtons[0].conditions).toEqual([
      { property: '', test: 'equals', value: '' },
    ])
  })

  it('are written as they are typed and chosen', async () => {
    const wrapper = open()
    await buttonWith(wrapper, 'Add condition').trigger('click')

    await conditionInputs(wrapper)[0].vm.$emit('update:model-value', 'status')
    await valueInputs(wrapper)[0].vm.$emit('update:model-value', 'todo')
    await testDropdowns(wrapper)[0].vm.$emit('update:model-value', 'not-equals')

    expect(config.headerButtons[0].conditions).toEqual([
      { property: 'status', test: 'not-equals', value: 'todo' },
    ])
  })

  it('ask for no value where the test does not compare one', async () => {
    config.headerButtons[0].conditions = [{ property: 'due', test: 'filled', value: '' }]
    const wrapper = open()

    expect(conditionInputs(wrapper)).toHaveLength(1)
    expect(valueInputs(wrapper)).toHaveLength(0)
  })

  it('offer all-or-any only once there are two', async () => {
    const wrapper = open()
    const modeDropdown = () =>
      wrapper
        .findAllComponents(Dropdown)
        .filter((d) => d.classes().includes('abele-header-buttons__mode'))

    await buttonWith(wrapper, 'Add condition').trigger('click')
    expect(modeDropdown()).toHaveLength(0)

    await buttonWith(wrapper, 'Add condition').trigger('click')
    expect(modeDropdown()).toHaveLength(1)

    await modeDropdown()[0].vm.$emit('update:model-value', 'any')
    expect(config.headerButtons[0].conditionMode).toBe('any')
  })

  it('are removed one at a time', async () => {
    config.headerButtons[0].conditions = [
      { property: 'status', test: 'equals', value: 'todo' },
      { property: 'due', test: 'filled', value: '' },
    ]
    const wrapper = open()

    const remove = wrapper
      .findAllComponents(Icon)
      .filter((i) => i.props('tooltip') === 'Remove this condition')
    await remove[0].trigger('click')

    expect(config.headerButtons[0].conditions).toEqual([
      { property: 'due', test: 'filled', value: '' },
    ])
  })
})

// Reported as «I added a button for tasks and it does not show»: a button set up for a type no
// note has, or a folder that is not there, showed nowhere and nothing said so.
describe('a header button that would show nowhere', () => {
  const badges = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAllComponents(Badge).map((b) => b.props('text'))

  it('says which of its types no note in the vault has, and which types there are', () => {
    config.headerButtons[0].noteTypes = ['tasks']
    const wrapper = open()

    expect(wrapper.text()).toContain('No note in this vault has the type "tasks"')
    expect(wrapper.text()).toContain('task')
    expect(badges(wrapper)).toContain('Shows nowhere')
  })

  it('says which of its folders are not in the vault', () => {
    config.headerButtons[0].noteTypes = []
    config.headerButtons[0].folders = ['Filmz']
    const wrapper = open()

    expect(wrapper.text()).toContain('No folder "Filmz" in this vault')
    expect(badges(wrapper)).toContain('Shows nowhere')
  })

  it('says nothing of the kind when it shows on real notes', () => {
    config.headerButtons[0].noteTypes = ['task']
    const wrapper = open()

    expect(wrapper.text()).not.toContain('No note in this vault')
    expect(badges(wrapper)).not.toContain('Shows nowhere')
  })
})
