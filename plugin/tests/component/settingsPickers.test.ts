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
import ScriptsSettings from '@/components/settings/ScriptsSettings.vue'
import LinksSettings from '@/components/settings/LinksSettings.vue'
import Button from '@/components/obsidian/Button.vue'
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

let config: AbeleConfig

beforeEach(() => {
  const app = useVault([]) as unknown as { vault: { getName: () => string } }
  app.vault.getName = () => 'Vault'

  config = AbeleConfig.getInstance()
  config.ai = { ...config.ai, scriptsEnabled: true, scriptsFolder: 'Scripts' }
  config.headerButtons = []
  config.links = []
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  vi.spyOn(ScriptService.getInstance(), 'getAll').mockReturnValue([fetchDetails, rename, legacy])
  pickScript.mockReset()
  pickCommand.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
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

  const open = () => mount(ScriptsSettings, { global: { stubs: STUBS } })

  it('is asked for rather than listed, so a folder of scripts is searchable', async () => {
    pickScript.mockResolvedValue(rename)
    const wrapper = open()

    await press(buttonWith(wrapper, 'Choose script...'))

    // Without the disabled one, which is not a script this vault runs any more.
    expect(pickScript).toHaveBeenCalledWith(expect.anything(), [fetchDetails, rename])
  })

  it('is what the button then shows, and what is saved', async () => {
    pickScript.mockResolvedValue(rename)
    const wrapper = open()

    await press(buttonWith(wrapper, 'Choose script...'))

    expect(buttonWith(wrapper, 'Rename').exists()).toBe(true)
    expect(config.headerButtons[0].scriptName).toBe('Rename')
  })

  it('is left alone when the picker is closed without a choice', async () => {
    config.headerButtons[0].scriptName = 'Fetch details'
    pickScript.mockResolvedValue(null)
    const wrapper = open()

    await press(buttonWith(wrapper, 'Fetch details'))

    expect(config.headerButtons[0].scriptName).toBe('Fetch details')
  })
})

describe('what a link runs', () => {
  const open = () => mount(LinksSettings, { global: { stubs: STUBS } })

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
    const wrapper = open()

    await press(buttonWith(wrapper, 'Choose script...'))

    // Every script, including the one no header button may run: a link is not a tool.
    expect(pickScript).toHaveBeenCalledWith(expect.anything(), [fetchDetails, rename, legacy])
    expect(config.links[0].scriptName).toBe('Fetch details')
  })

  it('stores a command by id but shows its name, which is what a person recognises', async () => {
    config.links = [
      { id: 'l1', name: 'bold', type: 'command', scriptName: '', commandId: '', waitForSync: true },
    ]
    pickCommand.mockResolvedValue(BOLD)
    const wrapper = open()

    await press(buttonWith(wrapper, 'Choose command...'))

    expect(config.links[0].commandId).toBe('editor:toggle-bold')
    expect(buttonWith(wrapper, 'Toggle bold').exists()).toBe(true)
  })

  it('falls back to the id of a command that is no longer installed', () => {
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

    const wrapper = mount(LinksSettings, { global: { stubs: STUBS } })

    expect(buttonWith(wrapper, 'removed-plugin:do-thing').exists()).toBe(true)
  })
})
