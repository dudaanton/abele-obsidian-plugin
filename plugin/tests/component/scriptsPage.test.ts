/**
 * The scripts page in settings: what is in the scripts folder, and the buttons that run them.
 *
 * It was one long form — the folder, then every header button as a block of fields — with
 * nothing saying which scripts there are or what they do. The library shows each script as a
 * card with its description and parameters; the header buttons have a tab of their own, where
 * each can be placed, switched off, shown by folder or everywhere, and deleted after asking.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ScriptsSettings from '@/components/settings/ScriptsSettings.vue'
import ScriptLibrary from '@/components/settings/scripts/ScriptLibrary.vue'
import HeaderButtonsEditor from '@/components/settings/scripts/HeaderButtonsEditor.vue'
import Card from '@/components/obsidian/Card.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Button from '@/components/obsidian/Button.vue'
import Input from '@/components/obsidian/Input.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Setting from '@/components/obsidian/Setting.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { AbeleConfig, type HeaderButtonDefinition } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

vi.mock('@/helpers/suggesters/RunnablePicker', () => ({
  pickScript: vi.fn(),
  pickCommand: vi.fn(),
  listCommands: () => [],
}))

const fetchDetails: ParsedScript = {
  path: 'Scripts/fetch.js',
  meta: {
    name: 'Fetch details',
    description: 'Fills a film note from the API.',
    icon: 'download',
    params: [
      { name: 'query', type: 'string', required: true, description: 'What to look up' },
      { name: 'mode', type: 'string', required: false, description: '', default: 'full' },
    ],
  },
  code: '',
  commandId: 'abele-script-fetch',
}
const archive: ParsedScript = {
  path: 'Scripts/archive.js',
  meta: { name: 'Archive', description: 'Moves the note to the archive.', params: [] },
  code: '',
  commandId: 'abele-script-archive',
}
const legacy: ParsedScript = {
  path: 'Scripts/legacy.js',
  meta: { name: 'Legacy', description: '', params: [], enabled: false },
  code: '',
  commandId: 'abele-script-legacy',
}

const STUBS = { Search: true, Dropdown: true }

let config: AbeleConfig

function button(overrides: Partial<HeaderButtonDefinition> = {}): HeaderButtonDefinition {
  return {
    id: 'b1',
    name: 'Fetch',
    icon: 'download',
    noteTypes: ['movie'],
    scriptName: 'Fetch details',
    params: {},
    enabled: true,
    iconOnly: false,
    allNotes: false,
    folders: [],
    ...overrides,
  }
}

beforeEach(() => {
  const app = useVault([]) as unknown as { vault: { getName: () => string } }
  app.vault.getName = () => 'Vault'

  config = AbeleConfig.getInstance()
  config.ai = { ...config.ai, scriptsEnabled: true, scriptsFolder: 'Scripts' }
  config.headerButtons = []
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  ScriptService.getInstance().scriptList.value = [fetchDetails, archive, legacy]
  vi.spyOn(ScriptService.getInstance(), 'getAll').mockReturnValue([fetchDetails, archive, legacy])
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Registered after the restore, so it runs before it: a screen left mounted still has its
// settings save waiting on a timer, and unmounting writes it now, into the stubbed save. Left
// for later, the timer fired after the real save was back — and on a loaded machine after the
// file had finished — where it threw for want of a plugin (three unhandled rejections).
enableAutoUnmount(afterEach)

const cards = (wrapper: VueWrapper) => wrapper.findAllComponents(Card)
const cardTitled = (wrapper: VueWrapper, title: string) => {
  const card = cards(wrapper).find((c) => c.props('title') === title)
  if (!card) throw new Error(`No card titled "${title}"`)
  return card
}
const iconWith = (wrapper: VueWrapper, tooltip: string) => {
  const icon = wrapper.findAllComponents(Icon).find((i) => i.props('tooltip') === tooltip)
  if (!icon) throw new Error(`No icon with tooltip "${tooltip}"`)
  return icon
}
const settingNamed = (wrapper: VueWrapper, name: string) =>
  wrapper.findAllComponents(Setting).find((s) => s.props('name') === name)

describe('the library', () => {
  const open = () => mount(ScriptLibrary, { global: { stubs: STUBS } })

  it('shows every script as a card, by name, with what it does and where it lives', () => {
    const wrapper = open()

    expect(cards(wrapper).map((c) => c.props('title'))).toEqual([
      'Archive',
      'Fetch details',
      'Legacy',
    ])
    const fetch = cardTitled(wrapper, 'Fetch details')
    expect(fetch.props('description')).toBe('Fills a film note from the API.')
    expect(fetch.props('subtitle')).toBe('Scripts/fetch.js')
    expect(fetch.props('icon')).toBe('download')
  })

  it('lists the parameters a script takes, marking the optional ones and their defaults', () => {
    const fetch = cardTitled(open(), 'Fetch details')

    expect(fetch.props('meta')).toEqual(['query: string', 'mode?: string = full'])
    expect(cardTitled(open(), 'Archive').props('meta')).toEqual(['No parameters'])
  })

  it('says so when a script has no description, rather than leaving the card bare', () => {
    expect(cardTitled(open(), 'Legacy').props('description')).toContain('@description')
  })

  it('marks a script switched off in its header, and offers no button for it', () => {
    const wrapper = open()

    expect(cardTitled(wrapper, 'Legacy').text()).toContain('Off')
    expect(
      cardTitled(wrapper, 'Legacy')
        .findAllComponents(Icon)
        .some((i) => i.props('tooltip') === 'Add a header button that runs this script')
    ).toBe(false)
  })

  it('counts the header buttons that run each script', () => {
    config.headerButtons = [button(), button({ id: 'b2' })]

    expect(cardTitled(open(), 'Fetch details').text()).toContain('2 buttons')
  })

  it('narrows to the scripts whose name or description holds what was typed', async () => {
    const wrapper = open()

    await wrapper.findComponent(Input).vm.$emit('update:model-value', 'archive')
    await nextTick()

    expect(cards(wrapper).map((c) => c.props('title'))).toEqual(['Archive'])
  })

  it('runs a script the way the command palette does, asking for its parameters', async () => {
    const run = vi.spyOn(ScriptService.getInstance(), 'executeFromCommand').mockResolvedValue()
    const wrapper = open()

    await cardTitled(wrapper, 'Fetch details')
      .findAllComponents(Icon)
      .find((i) => i.props('tooltip') === 'Run this script now')!
      .trigger('click')

    expect(run).toHaveBeenCalledWith('Scripts/fetch.js')
  })

  it('makes a header button for a script, and says which one was made', async () => {
    const wrapper = open()

    await cardTitled(wrapper, 'Archive')
      .findAllComponents(Icon)
      .find((i) => i.props('tooltip') === 'Add a header button that runs this script')!
      .trigger('click')

    expect(config.headerButtons).toHaveLength(1)
    expect(config.headerButtons[0]).toMatchObject({ name: 'Archive', scriptName: 'Archive' })
    expect(wrapper.emitted('added')).toEqual([[config.headerButtons[0].id]])
  })

  it('says scripts are off, and where to turn them on, when they are', () => {
    config.ai = { ...config.ai, scriptsEnabled: false }

    const wrapper = open()

    expect(cards(wrapper)).toHaveLength(0)
    expect(wrapper.text()).toContain('General')
  })
})

describe('the scripts page', () => {
  const open = () => mount(ScriptsSettings, { global: { stubs: STUBS } })

  it('opens on the library when scripts are on', () => {
    expect(open().findComponent(ScriptLibrary).exists()).toBe(true)
  })

  it('opens on the switch that turns them on when they are off', () => {
    config.ai = { ...config.ai, scriptsEnabled: false }

    const wrapper = open()

    expect(wrapper.findComponent(ScriptLibrary).exists()).toBe(false)
    expect(wrapper.text()).toContain('Enable scripts')
  })

  it('takes a button made from the library straight to where it is set up', async () => {
    const wrapper = open()

    await cardTitled(wrapper, 'Archive')
      .findAllComponents(Icon)
      .find((i) => i.props('tooltip') === 'Add a header button that runs this script')!
      .trigger('click')
    await nextTick()

    expect(wrapper.findComponent(HeaderButtonsEditor).exists()).toBe(true)
    expect(cards(wrapper).map((c) => c.props('title'))).toEqual(['Archive'])
  })
})

describe('the header buttons', () => {
  const open = () => mount(HeaderButtonsEditor, { global: { stubs: STUBS } })

  it('moves a button later in the header, and keeps that order', async () => {
    config.headerButtons = [button({ id: 'a', name: 'First' }), button({ id: 'b', name: 'Second' })]
    const wrapper = open()

    await cardTitled(wrapper, 'First')
      .findAllComponents(Icon)
      .find((i) => i.props('tooltip') === 'Move later in the header')!
      .trigger('click')

    expect(config.headerButtons.map((b) => b.name)).toEqual(['Second', 'First'])
  })

  it('cannot move the first button earlier or the last one later', () => {
    config.headerButtons = [button({ id: 'a', name: 'First' }), button({ id: 'b', name: 'Second' })]
    const wrapper = open()

    const up = cardTitled(wrapper, 'First')
      .findAllComponents(Icon)
      .find((i) => i.props('tooltip')?.startsWith('Move earlier'))!
    const down = cardTitled(wrapper, 'Second')
      .findAllComponents(Icon)
      .find((i) => i.props('tooltip')?.startsWith('Move later'))!
    expect(up.props('disabled')).toBe(true)
    expect(down.props('disabled')).toBe(true)
  })

  it('asks before deleting a button, and deletes it only when told to', async () => {
    config.headerButtons = [button({ name: 'Fetch' })]
    const wrapper = open()

    await iconWith(wrapper, 'Delete this button').trigger('click')
    expect(config.headerButtons).toHaveLength(1)

    const confirm = wrapper.findComponent(ConfirmModal)
    expect(confirm.props('message')).toContain('Fetch')
    confirm.vm.$emit('confirm')
    await nextTick()

    expect(config.headerButtons).toHaveLength(0)
  })

  it('switches a button off without losing how it was set up', async () => {
    config.headerButtons = [button()]
    const wrapper = open()

    await settingNamed(wrapper, 'Show this button')!.findComponent(Checkbox).trigger('click')

    expect(config.headerButtons[0]).toMatchObject({ enabled: false, noteTypes: ['movie'] })
    expect(cardTitled(wrapper, 'Fetch').text()).toContain('Off')
  })

  it('shows only the icon when asked to', async () => {
    config.headerButtons = [button()]
    const wrapper = open()

    await settingNamed(wrapper, 'Icon only')!.findComponent(Checkbox).trigger('click')

    expect(config.headerButtons[0].iconOnly).toBe(true)
  })

  it('puts a button on every note, and stops asking which then', async () => {
    config.headerButtons = [button()]
    const wrapper = open()

    await settingNamed(wrapper, 'On every note')!.findComponent(Checkbox).trigger('click')

    expect(config.headerButtons[0].allNotes).toBe(true)
    expect(settingNamed(wrapper, 'Note types')).toBeUndefined()
    expect(settingNamed(wrapper, 'Folders')).toBeUndefined()
  })

  it('takes folders as a comma-separated list', async () => {
    config.headerButtons = [button()]
    const wrapper = open()

    await settingNamed(wrapper, 'Folders')!
      .findComponent(Input)
      .vm.$emit('update:model-value', 'Films, Books/Read ')

    expect(config.headerButtons[0].folders).toEqual(['Films', 'Books/Read'])
  })

  it('says what a new button needs before it shows anywhere', async () => {
    const wrapper = open()

    await wrapper
      .findAllComponents(Button)
      .find((b) => b.props('text') === 'Add button')!
      .trigger('click')

    expect(config.headerButtons).toHaveLength(1)
    expect(cardTitled(wrapper, 'Unnamed button').props('subtitle')).toBe('No script chosen yet')
  })
})
