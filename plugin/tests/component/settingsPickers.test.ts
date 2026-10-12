/**
 * Choosing a script or a command on the settings screens.
 *
 * Both settings offered a `Dropdown`: every script in the folder, every command in Obsidian,
 * in one unsearchable list. They now open the fuzzy picker instead, which leaves the screens
 * with three things to get right — offering the picker the right list, storing what comes
 * back, and showing what is stored. The last one is not cosmetic for a link, which stores a
 * command's id and must show its name.
 *
 * The picker itself is faked: what it offers and what it hands back is settled in
 * `tests/unit/runnablePicker.test.ts`, and a modal cannot be opened for real here anyway.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import HeaderButtonsEditor from '@/components/settings/scripts/HeaderButtonsEditor.vue'
import ScriptsGeneral from '@/components/settings/scripts/ScriptsGeneral.vue'
import LinksSettings from '@/components/settings/LinksSettings.vue'
import Button from '@/components/obsidian/Button.vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

const { pickScript, pickCommand } = vi.hoisted(() => ({
  pickScript: vi.fn(),
  pickCommand: vi.fn(),
}))

const BOLD = { id: 'editor:toggle-bold', name: 'Toggle bold' }

vi.mock('@/helpers/suggesters/RunnablePicker', () => ({
  pickScript,
  pickCommand,
  listCommands: () => [BOLD],
}))

function script(name: string, description = ''): ParsedScript {
  return {
    path: `Scripts/${name}.js`,
    meta: { name, description, params: [] },
    code: '',
    commandId: `abele-script-${name}`,
  }
}

const fetchDetails = script('Fetch details', 'Fills a film note from the API.')
const rename = script('Rename')
/** Switched off in its own header comment: a header button may not run it, a link still may. */
const legacy = { ...script('Legacy'), meta: { ...script('Legacy').meta, enabled: false } }

/**
 * The two kit controls that wrap an Obsidian component of their own — the folder field and the
 * link's type dropdown. Neither is what these are about, and both build a widget the mock
 * vault has no stand-in for.
 */
const STUBS = { Search: true, Dropdown: true }

import { useFakeClock } from '../helpers/fakeClock'
const advance = useFakeClock()

let config: AbeleConfig

beforeEach(() => {
  const app = useVault([]) as unknown as { vault: { getName: () => string } }
  app.vault.getName = () => 'Vault'

  config = AbeleConfig.getInstance()
  config.ai = { ...config.ai, scriptsEnabled: true, scriptsFolder: 'Scripts' }
  config.headerButtons = []
  config.links = []
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  ScriptService.getInstance().scriptList.value = [fetchDetails, rename, legacy]
  vi.spyOn(ScriptService.getInstance(), 'getAll').mockReturnValue([fetchDetails, rename, legacy])
  pickScript.mockReset()
  pickCommand.mockReset()
})

/**
 * Every screen mounted here, unmounted before the spies come off. A screen holds its disk
 * write back for half a second; left mounted, that write fired after the test had ended,
 * reached the real `saveSettings` with no plugin behind it and failed a later test at random.
 * Unmounting flushes it while `saveSettings` is still the spy.
 */
const mounted = new Set<ReturnType<typeof mount>>()
function mountScreen(...args: Parameters<typeof mount>): ReturnType<typeof mount> {
  const wrapper = mount(...args)
  mounted.add(wrapper)
  const unmount = wrapper.unmount.bind(wrapper)
  wrapper.unmount = () => {
    if (mounted.delete(wrapper)) unmount()
  }
  return wrapper
}

afterEach(async () => {
  for (const wrapper of [...mounted]) wrapper.unmount()
  vi.restoreAllMocks()
  // Let any write left by a screen surface after teardown, on the controlled clock.
  await advance(700)
})

/** The button carrying a given label, which is how each of these reads its current value. */
function buttonWith(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAllComponents(Button).find((b) => b.props('text') === text)
  if (!button) {
    const labels = wrapper.findAllComponents(Button).map((b) => b.props('text'))
    throw new Error(`No button labelled "${text}". Present: ${labels.join(', ')}`)
  }
  return button
}

/** Opens an entry's window from the settings glyph on its row, where its fields are. */
async function change(wrapper: ReturnType<typeof mount>, label: string, index = 0) {
  await wrapper.findAll(`button[aria-label="${label}"]`)[index].trigger('click')
  await nextTick()
}

/** Presses a button and lets the picker's promise settle. */
async function press(button: ReturnType<typeof buttonWith>) {
  await button.trigger('click')
  await nextTick()
  await nextTick()
}

describe('the script a header button runs', () => {
  beforeEach(() => {
    config.headerButtons = [
      {
        id: 'b1',
        name: 'Fetch',
        icon: 'download',
        noteTypes: ['movie'],
        scriptName: '',
        params: {},
      },
    ]
  })

  /** The editor with the button's own window open, where what it runs is chosen. */
  const open = async () => {
    const wrapper = mountScreen(HeaderButtonsEditor, { global: { stubs: STUBS } })
    await change(wrapper, 'Change this button')
    return wrapper
  }

  it('is asked for rather than listed, so a folder of scripts is searchable', async () => {
    pickScript.mockResolvedValue(rename)
    const wrapper = await open()

    await press(buttonWith(wrapper, 'Choose script...'))

    // Without the disabled one, which is not a script this vault runs any more.
    expect(pickScript).toHaveBeenCalledWith(expect.anything(), [fetchDetails, rename])
  })

  it('is what the button then shows, and what is saved', async () => {
    pickScript.mockResolvedValue(rename)
    const wrapper = await open()

    await press(buttonWith(wrapper, 'Choose script...'))

    expect(buttonWith(wrapper, 'Rename').exists()).toBe(true)
    expect(config.headerButtons[0].scriptName).toBe('Rename')
  })

  it('is left alone when the picker is closed without a choice', async () => {
    config.headerButtons[0].scriptName = 'Fetch details'
    pickScript.mockResolvedValue(null)
    const wrapper = await open()

    await press(buttonWith(wrapper, 'Fetch details'))

    expect(config.headerButtons[0].scriptName).toBe('Fetch details')
  })

  it('writes an edit that is still waiting when the settings screen closes', async () => {
    vi.mocked(config.saveSettings).mockClear()
    const wrapper = await open()

    await press(buttonWith(wrapper, 'Add button'))

    expect(config.headerButtons).toHaveLength(2)
    expect(config.saveSettings).not.toHaveBeenCalled()

    wrapper.unmount()

    expect(config.saveSettings).toHaveBeenCalledOnce()
  })

  it('keeps its parameters when the same script is chosen again', async () => {
    config.headerButtons[0].scriptName = 'Fetch details'
    config.headerButtons[0].params = { query: '{{title}}' }
    pickScript.mockResolvedValue(fetchDetails)
    const wrapper = await open()

    await press(buttonWith(wrapper, 'Fetch details'))

    expect(config.headerButtons[0].params).toEqual({ query: '{{title}}' })
  })

  it('drops its parameters when a different script is chosen', async () => {
    config.headerButtons[0].scriptName = 'Fetch details'
    config.headerButtons[0].params = { query: '{{title}}' }
    pickScript.mockResolvedValue(rename)
    const wrapper = await open()

    await press(buttonWith(wrapper, 'Fetch details'))

    expect(config.headerButtons[0].params).toEqual({})
  })

  // Settings reloaded from disk — sync from another device — while this screen is open. The
  // list it copied when it opened is the old one, and the next edit would save it back.
  it('follows settings that changed while it was open', async () => {
    const wrapper = await open()
    expect(buttonWith(wrapper, 'Choose script...').exists()).toBe(true)

    config.headerButtons = [{ ...config.headerButtons[0], scriptName: 'Rename' }]
    config.version.value++
    await nextTick()

    expect(buttonWith(wrapper, 'Rename').exists()).toBe(true)
    await press(buttonWith(wrapper, 'Add button'))
    expect(config.headerButtons.map((b) => b.scriptName)).toEqual(['Rename', ''])
  })

  it('keeps an edit of its own that is still waiting to be saved', async () => {
    const wrapper = await open()
    await press(buttonWith(wrapper, 'Add button'))

    config.version.value++
    await nextTick()

    expect(config.headerButtons).toHaveLength(2)
    // The one added is a command button, open in its window; the one it had still waits for
    // its script.
    expect(buttonWith(wrapper, 'Choose command...').exists()).toBe(true)
    await change(wrapper, 'Change this button', 0)
    expect(buttonWith(wrapper, 'Choose script...').exists()).toBe(true)
  })
})

describe('the scripts folder', () => {
  it('is saved when the settings screen closes before the save came round', async () => {
    vi.mocked(config.saveSettings).mockClear()
    const wrapper = mountScreen(ScriptsGeneral, { global: { stubs: STUBS } })

    wrapper.findComponent({ name: 'Search' }).vm.$emit('update:model-value', 'System/Scripts')
    expect(config.saveSettings).not.toHaveBeenCalled()
    wrapper.unmount()

    expect(config.ai.scriptsFolder).toBe('System/Scripts')
    expect(config.saveSettings).toHaveBeenCalledOnce()
  })
})

describe('what a link runs', () => {
  /** The links with the first one's window open, where what it runs is chosen. */
  const open = async () => {
    const wrapper = mountScreen(LinksSettings, { global: { stubs: STUBS } })
    await change(wrapper, 'Change this link')
    return wrapper
  }

  it('offers the scripts to search, and saves the one taken', async () => {
    config.links = [
      {
        id: 'l1',
        name: 'add-movie',
        type: 'script',
        scriptName: '',
        commandId: '',
        waitForSync: true,
      },
    ]
    pickScript.mockResolvedValue(fetchDetails)
    const wrapper = await open()

    await press(buttonWith(wrapper, 'Choose a script…'))

    // Every script, including the one no header button may run: a link is not a tool.
    expect(pickScript).toHaveBeenCalledWith(expect.anything(), [fetchDetails, rename, legacy])
    expect(config.links[0].scriptName).toBe('Fetch details')
  })

  it('stores a command by id but shows its name, which is what a person recognises', async () => {
    config.links = [
      { id: 'l1', name: 'bold', type: 'command', scriptName: '', commandId: '', waitForSync: true },
    ]
    pickCommand.mockResolvedValue(BOLD)
    const wrapper = await open()

    await press(buttonWith(wrapper, 'Choose a command…'))

    expect(config.links[0].commandId).toBe('editor:toggle-bold')
    expect(buttonWith(wrapper, 'Toggle bold').exists()).toBe(true)
  })

  it('falls back to the id of a command that is no longer installed', async () => {
    config.links = [
      {
        id: 'l1',
        name: 'gone',
        type: 'command',
        scriptName: '',
        commandId: 'removed-plugin:do-thing',
        waitForSync: true,
      },
    ]

    const wrapper = mountScreen(LinksSettings, { global: { stubs: STUBS } })
    // Said on the row too, as what it runs.
    expect(wrapper.find('.abele-links__row').text()).toContain(
      'Runs the command removed-plugin:do-thing'
    )
    await change(wrapper, 'Change this link')

    expect(buttonWith(wrapper, 'removed-plugin:do-thing').exists()).toBe(true)
  })
})

describe('the scripts screen while the folder is being read', () => {
  it('shows the scripts once the index has them, however late that is', async () => {
    ScriptService.getInstance().scriptList.value = []
    const wrapper = mountScreen(ScriptsGeneral, { global: { stubs: STUBS } })
    expect(wrapper.text()).not.toContain('scripts discovered')

    ScriptService.getInstance().scriptList.value = [fetchDetails, rename]
    await nextTick()

    expect(wrapper.text()).toContain('2 scripts discovered')
  })
})

describe('the list of links', () => {
  const link = (id: string, name: string) => ({
    id,
    name,
    type: 'script' as const,
    scriptName: 'Fetch details',
    commandId: '',
    waitForSync: true,
  })

  it('is a row a link, saying what it runs, its address copied from the row', async () => {
    config.links = [link('l1', 'add-movie')]
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const wrapper = mountScreen(LinksSettings, { global: { stubs: STUBS } })
    const row = wrapper.get('.abele-links__row')
    expect(row.text()).toContain('add-movie')
    expect(row.text()).toContain('Runs the script Fetch details')
    await row.get('button[aria-label="Copy the link\'s address"]').trigger('click')
    expect(writeText).toHaveBeenCalledWith('obsidian://abele?vault=Vault&name=add-movie')
    expect(wrapper.findComponent(ObsidianModal).exists()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('opens a link in a window named after it, and deletes it from there at once', async () => {
    config.links = [link('l1', 'add-movie'), link('l2', 'add-book')]
    const wrapper = mountScreen(LinksSettings, { global: { stubs: STUBS } })
    await change(wrapper, 'Change this link', 1)
    expect(wrapper.findComponent(ObsidianModal).props('title')).toBe('add-book')
    await press(buttonWith(wrapper, 'Delete'))
    expect(wrapper.findComponent(ObsidianModal).exists()).toBe(false)
    expect(wrapper.findAll('.abele-links__row').map((r) => r.text())).toEqual([
      expect.stringContaining('add-movie'),
    ])
    wrapper.unmount()
    expect(config.links.map((l) => l.id)).toEqual(['l1'])
  })

  it('opens a new link in its window as soon as it is added, and Done closes it', async () => {
    const wrapper = mountScreen(LinksSettings, { global: { stubs: STUBS } })
    expect(wrapper.text()).toContain('No links yet')
    await press(buttonWith(wrapper, 'Add link'))
    expect(wrapper.findComponent(ObsidianModal).props('title')).toBe('New link')
    await press(buttonWith(wrapper, 'Done'))
    expect(wrapper.findComponent(ObsidianModal).exists()).toBe(false)
    expect(wrapper.findAll('.abele-links__row')).toHaveLength(1)
  })
})
