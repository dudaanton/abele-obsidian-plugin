/**
 * The header button form: its icon, chosen from a grid, and the properties a note must have.
 *
 * Which buttons a note then shows is `tests/unit/headerButtons.test.ts`; the script picker of
 * the same form is in `settingsPickers.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import HeaderButtonsEditor from '@/components/settings/scripts/HeaderButtonsEditor.vue'
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Input from '@/components/obsidian/Input.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import IconPicker from '@/components/obsidian/IconPicker.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { AbeleConfig, normalizeHeaderButton } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import * as RunnablePicker from '@/helpers/suggesters/RunnablePicker'
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

/**
 * The list, with the first button's window opened from the settings glyph on its row, as its
 * fields are only there. With no buttons yet there is nothing to open: Add button opens the new one.
 */
async function openEditing() {
  const wrapper = open()
  const change = wrapper.findAll('button[aria-label="Change this button"]')
  if (change.length) await change[0].trigger('click')
  await nextTick()
  return wrapper
}

/** What is on screen: the list, and the button's window, which Obsidian puts in the body. */
const seen = (wrapper: ReturnType<typeof mount>) =>
  `${wrapper.text()} ${document.body.textContent ?? ''}`

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
    const wrapper = await openEditing()

    const choose = buttonWith(wrapper, 'download')
    expect(choose.props('icon')).toBe('download')
    await choose.trigger('click')

    const picker = wrapper.findComponent(IconPicker)
    expect(picker.exists()).toBe(true)
    expect(picker.props('current')).toBe('download')
  })

  it('is what was picked, saved, and the grid closes', async () => {
    const wrapper = await openEditing()
    await buttonWith(wrapper, 'download').trigger('click')

    wrapper.findComponent(IconPicker).vm.$emit('choose', 'calendar')
    await nextTick()

    expect(config.headerButtons[0].icon).toBe('calendar')
    expect(wrapper.findComponent(IconPicker).exists()).toBe(false)
    expect(buttonWith(wrapper, 'calendar').exists()).toBe(true)
  })

  it('stays as it was when the grid is closed without a choice', async () => {
    const wrapper = await openEditing()
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
    const wrapper = await openEditing()
    expect(conditionInputs(wrapper)).toHaveLength(0)

    await buttonWith(wrapper, 'Add condition').trigger('click')

    expect(conditionInputs(wrapper)).toHaveLength(1)
    expect(config.headerButtons[0].conditions).toEqual([
      { property: '', test: 'equals', value: '' },
    ])
  })

  it('are written as they are typed and chosen', async () => {
    const wrapper = await openEditing()
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
    const wrapper = await openEditing()

    expect(conditionInputs(wrapper)).toHaveLength(1)
    expect(valueInputs(wrapper)).toHaveLength(0)
  })

  it('offer all-or-any only once there are two', async () => {
    const wrapper = await openEditing()
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
    const wrapper = await openEditing()

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
  /** The warning on the button's row in the list, before anything is opened. */
  const warning = (wrapper: ReturnType<typeof mount>) =>
    wrapper.find('.abele-header-buttons__row .mod-warning')

  it('says which of its types no note in the vault has, and which types there are', async () => {
    config.headerButtons[0].noteTypes = ['tasks']
    const wrapper = open()

    expect(warning(wrapper).text()).toMatch(/^Shows nowhere · /)
    await wrapper.get('button[aria-label="Change this button"]').trigger('click')
    expect(seen(wrapper)).toContain('No note in this vault has the type "tasks"')
    expect(seen(wrapper)).toContain('Types in use: movie, task')
  })

  it('says which of its folders are not in the vault', async () => {
    config.headerButtons[0].noteTypes = []
    config.headerButtons[0].folders = ['Filmz']
    const wrapper = open()

    expect(warning(wrapper).text()).toMatch(/^Shows nowhere · /)
    await wrapper.get('button[aria-label="Change this button"]').trigger('click')
    expect(seen(wrapper)).toContain('No folder "Filmz" in this vault')
  })

  it('says nothing of the kind when it shows on real notes', async () => {
    config.headerButtons[0].noteTypes = ['task']
    const wrapper = open()

    expect(warning(wrapper).exists()).toBe(false)
    await wrapper.get('button[aria-label="Change this button"]').trigger('click')
    expect(seen(wrapper)).not.toContain('No note in this vault')
  })

  it('says nothing of it while the button is switched off', () => {
    config.headerButtons[0].noteTypes = ['tasks']
    config.headerButtons[0].enabled = false
    const wrapper = open()

    expect(warning(wrapper).exists()).toBe(false)
    expect(wrapper.find('.abele-header-buttons__row').classes()).toContain(
      'abele-header-buttons__row_off'
    )
  })
})

describe('a header button that runs a command', () => {
  const BOLD = { id: 'editor:toggle-bold', name: 'Toggle bold', icon: 'bold' }
  const commands = new Map([[BOLD.id, BOLD]])

  beforeEach(() => {
    const { app } = GlobalStore.getInstance() as unknown as { app: Record<string, unknown> }
    app.commands = {
      findCommand: (id: string) => commands.get(id),
      listCommands: () => [...commands.values()],
      executeCommandById: () => true,
    }
  })

  const settingNamed = (wrapper: ReturnType<typeof mount>, name: string) =>
    wrapper.findAllComponents(Setting).find((s) => s.props('name') === name)
  const runsDropdown = (wrapper: ReturnType<typeof mount>) =>
    settingNamed(wrapper, 'Runs')!.findComponent(Dropdown)

  it('is what a new button is, shown on every note until told otherwise', async () => {
    config.headerButtons = []
    const wrapper = await openEditing()

    await buttonWith(wrapper, 'Add button').trigger('click')

    expect(config.headerButtons[0]).toMatchObject({ runs: 'command', allNotes: true })
    expect(buttonWith(wrapper, 'Choose command...').exists()).toBe(true)
    expect(settingNamed(wrapper, 'Script')).toBeUndefined()
    expect(settingNamed(wrapper, 'Icon only')).toBeUndefined()
  })

  it('takes its command from the searchable list, and its name and icon with it', async () => {
    vi.spyOn(RunnablePicker, 'pickCommand').mockResolvedValue(BOLD as never)
    config.headerButtons = []
    const wrapper = await openEditing()
    await buttonWith(wrapper, 'Add button').trigger('click')

    await buttonWith(wrapper, 'Choose command...').trigger('click')
    await flushPromises()

    expect(config.headerButtons[0]).toMatchObject({
      commandId: 'editor:toggle-bold',
      name: 'Toggle bold',
      icon: 'bold',
    })
    expect(buttonWith(wrapper, 'Toggle bold').exists()).toBe(true)
  })

  it('keeps a name and an icon of its own when the command changes', async () => {
    vi.spyOn(RunnablePicker, 'pickCommand').mockResolvedValue(BOLD as never)
    config.headerButtons = [
      normalizeHeaderButton({ id: 'c', name: 'Mine', icon: 'star', runs: 'command' }),
    ]
    const wrapper = await openEditing()

    await buttonWith(wrapper, 'Choose command...').trigger('click')
    await flushPromises()

    expect(config.headerButtons[0]).toMatchObject({ name: 'Mine', icon: 'star' })
  })

  it('turns into a script button and back, keeping what each had', async () => {
    config.headerButtons = [
      normalizeHeaderButton({ id: 'c', runs: 'command', commandId: BOLD.id, scriptName: 'Fetch' }),
    ]
    const wrapper = await openEditing()

    await runsDropdown(wrapper).vm.$emit('update:model-value', 'script')
    expect(config.headerButtons[0].runs).toBe('script')
    expect(settingNamed(wrapper, 'Script')).toBeDefined()
    expect(settingNamed(wrapper, 'Command')).toBeUndefined()

    await runsDropdown(wrapper).vm.$emit('update:model-value', 'command')
    expect(config.headerButtons[0]).toMatchObject({ runs: 'command', commandId: BOLD.id })
  })

  it('offers files other than notes, for a command button only', async () => {
    config.headerButtons = [normalizeHeaderButton({ id: 'c', runs: 'command' })]
    const wrapper = await openEditing()

    await settingNamed(wrapper, 'Also on other files')!.findComponent(Checkbox).vm.$emit('toggle')
    expect(config.headerButtons[0].otherFiles).toBe(true)

    await runsDropdown(wrapper).vm.$emit('update:model-value', 'script')
    expect(settingNamed(wrapper, 'Also on other files')).toBeUndefined()
  })

  it('is placed by tags, typed as a list', async () => {
    config.headerButtons = [normalizeHeaderButton({ id: 'c', runs: 'command' })]
    const wrapper = await openEditing()

    await settingNamed(wrapper, 'Tags')!
      .findComponent(Input)
      .vm.$emit('update:model-value', '#work, project/site ')

    expect(config.headerButtons[0].tags).toEqual(['#work', 'project/site'])
  })

  it('says it shows nowhere while its command is not there — its plugin switched off', async () => {
    config.headerButtons = [
      normalizeHeaderButton({ id: 'c', runs: 'command', commandId: 'dataview:refresh' }),
    ]
    const wrapper = await openEditing()

    const warning = wrapper.get('.abele-header-buttons__row .mod-warning')
    expect(warning.text()).toMatch(/^Shows nowhere · /)
    expect(warning.attributes('title')).toContain('not available')
    expect(buttonWith(wrapper, 'dataview:refresh').exists()).toBe(true)
  })
})

describe('the list of header buttons', () => {
  const second = normalizeHeaderButton({ id: 'b2', name: 'Refresh poster', runs: 'command' })
  const names = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('.abele-header-buttons__name').map((n) => n.text())

  it('is one row a button, in header order, moved up and down from its row', async () => {
    config.headerButtons = [config.headerButtons[0], second]
    const wrapper = open()
    expect(names(wrapper)).toEqual(['Fetch', 'Refresh poster'])
    const rows = wrapper.findAll('.abele-header-buttons__row')
    // The first cannot go earlier, nor the last later.
    expect(rows[0].get('button[aria-label^="Move earlier"]').attributes('disabled')).toBeDefined()
    expect(rows[1].get('button[aria-label^="Move later"]').attributes('disabled')).toBeDefined()

    await rows[1].get('button[aria-label="Move earlier in the header"]').trigger('click')
    expect(config.headerButtons.map((b) => b.id)).toEqual(['b2', 'b1'])
    expect(names(wrapper)).toEqual(['Refresh poster', 'Fetch'])
    // Nothing opened for it.
    expect(wrapper.findComponent(ObsidianModal).exists()).toBe(false)
  })

  it('switches a button off from its row', async () => {
    const wrapper = open()
    await wrapper.get('.abele-header-buttons__row').findComponent(Checkbox).vm.$emit('toggle')
    expect(config.headerButtons[0].enabled).toBe(false)
  })

  it('opens a button in a window named after it, what it runs first and where it shows after', async () => {
    const wrapper = await openEditing()
    expect(wrapper.findComponent(ObsidianModal).props('title')).toBe('Fetch')
    const headings = wrapper
      .findAllComponents(Setting)
      .filter((st) => st.props('heading'))
      .map((st) => st.props('name'))
    expect(headings).toEqual(['What it runs', 'Where it shows'])
    await buttonWith(wrapper, 'Done').trigger('click')
    expect(wrapper.findComponent(ObsidianModal).exists()).toBe(false)
  })

  it('deletes a button from its window only once that is confirmed', async () => {
    const wrapper = await openEditing()
    await buttonWith(wrapper, 'Delete').trigger('click')
    expect(config.headerButtons).toHaveLength(1)
    const confirm = wrapper.findComponent(ConfirmModal)
    expect(confirm.props('message')).toContain('Fetch')
    confirm.vm.$emit('confirm')
    await nextTick()
    expect(config.headerButtons).toEqual([])
    expect(wrapper.findComponent(ObsidianModal).exists()).toBe(false)
  })

  it('opens a new button in its window as soon as it is added', async () => {
    config.headerButtons = []
    const wrapper = open()
    expect(wrapper.text()).toContain('No header buttons yet')
    await buttonWith(wrapper, 'Add button').trigger('click')
    expect(config.headerButtons).toHaveLength(1)
    expect(wrapper.findComponent(ObsidianModal).props('title')).toBe('New button')
  })
})
