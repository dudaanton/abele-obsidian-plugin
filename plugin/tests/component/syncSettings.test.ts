/**
 * The Sync tab.
 *
 * The engine itself is the sibling repo's and is tested there; what is asserted here is the
 * half a settings screen owes it. A device nobody has set up is offered a way to set it up and
 * nothing else. A device that is set up is shown what it is doing and what it is doing it to.
 * A switch that is ticked reaches the device's connection through the service — which is what
 * puts the running engine in step — and never `data.json`, which other devices can be handed.
 *
 * The service is a stand-in: it owns an IndexedDB, a WebSocket and a real server connection,
 * none of which a component test has any business opening. Its shape is the shape the real one
 * publishes, so a method renamed there fails to compile here.
 */
import Checkbox from '@/components/obsidian/Checkbox.vue'
import SelectiveSync from '@/components/settings/sync/SelectiveSync.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { emptyConnection, type DeviceConnection } from '@/sync/connection'
import { defaultSyncSettings } from '@/sync/settings'
import { DISCONNECTED_STATUS, type SyncStatus } from '@/sync/status'
import { type ChangeItem } from '@abele/sync-sdk/protocol'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { useVault } from '../helpers/testEnv'

/** Obsidian's own widgets need a real app to construct; what they hold is tested elsewhere. */
const STUBS = { Search: true, Dropdown: true }

const VAULT_SETTINGS = {
  conflict: 'merge' as const,
  max_file_bytes: 200 * 1024 * 1024,
  quota_bytes: null,
  retention: { notes_days: 365, attachments_days: 14, settings_days: 30 },
  scripts_folder: 'Scripts',
  key_signature: null,
}

const USAGE = {
  live_bytes: 4096,
  history_bytes: 2048,
  trash_bytes: 512,
  quota_bytes: null,
  by_kind: { note: { live_bytes: 3072, count: 12 }, attachment: { live_bytes: 1024, count: 2 } },
  top: [{ file_id: 'f1', path: 'Notes/heavy.md', history_bytes: 1500, versions: 40 }],
}

/** The vault client the policy and usage cards read through. */
const client = {
  state: vi.fn(),
  usage: vi.fn(),
  updateSettings: vi.fn(),
}

/** The service, with everything the screens call on it and nothing that opens a socket. */
const service = {
  status: ref<SyncStatus>({ ...DISCONNECTED_STATUS }),
  log: ref<string[]>([]),
  connection: ref<DeviceConnection>(emptyConnection()),
  connected: false,
  sharing: shallowRef<any>(null),
  isConnected: vi.fn(() => service.connected),
  client: vi.fn(() => (service.connected ? client : null)),
  connect: vi.fn(),
  chooseVault: vi.fn(),
  disconnect: vi.fn(),
  forget: vi.fn(),
  syncNow: vi.fn(),
  rescan: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  note: vi.fn(),
  onSettingsSaved: vi.fn(),
  endConnect: vi.fn(),
  updateConnection: vi.fn(),
  retryPendingRevokes: vi.fn(() => Promise.resolve()),
  forgetPendingRevoke: vi.fn(),
  telling: ref<string | null>(null),
  joinQuestion: vi.fn(),
  answerJoin: vi.fn(),
  heldPrompt: { held: ref<{ path: string; fileId: string }[]>([]), decided: ref(null) },
  codePrompt: { staged: ref([]), ask: vi.fn() },
  settingsPrompt: {
    staged: ref<ChangeItem[]>([]),
    names: ref<Record<string, string>>({}),
    reloader: { available: () => true, reload: () => true },
  },
  applySettingsAndReload: vi.fn(),
  listDevices: vi.fn(() => Promise.resolve(null)),
  revokeDevice: vi.fn(),
  keepLocalSettings: vi.fn(),
  decideDeletes: vi.fn(),
}

/** The connection the service holds, with these fields changed — what its verbs do. */
const change = (patch: Partial<DeviceConnection>): void => {
  service.connection.value = { ...service.connection.value, ...patch }
}

/** What this device syncs, as the service holds it. */
const held = () => service.connection.value.selective

/** What `init` does in the running plugin: the service hears about every settings save. */
let unhook: () => void

// Each profile owns its mounts. Leaving previous screens subscribed makes every subsequent
// connection/profile reset redraw all the screens that earlier cases forgot to close.
const screens: Array<ReturnType<typeof mount>> = []
const open = <T>(component: T, props: Record<string, unknown> = {}) => {
  const screen = mount(component as never, { props, global: { stubs: STUBS } })
  screens.push(screen)
  return screen
}
type Screen = ReturnType<typeof open>

/** Text typed into a field, which fires `input` alone; `setValue` would fire `change` too. */
async function type(field: ReturnType<Screen['find']>, text: string): Promise<void> {
  ;(field.element as HTMLInputElement).value = text
  await field.trigger('input')
  await flushPromises()
}

/** The checkbox of one selective row, found by the key its setting names. */
const switchFor = (screen: Screen, key: string) =>
  screen.find(`[data-selective="${key}"]`).findComponent(Checkbox)

beforeEach(() => {
  useVault([])
  const config = AbeleConfig.getInstance()
  // The whole settings object, not just the sync half: `saveSettings` exports all of it.
  config.applySettings()
  config.sync = defaultSyncSettings()
  // A plugin that writes nowhere: `saveSettings` still runs, so its listeners still fire.
  config.init({ saveData: vi.fn(), syncAiFeatures: vi.fn() } as never)
  unhook = config.onSaved(() => service.onSettingsSaved())

  service.chooseVault.mockReset().mockResolvedValue(undefined)
  service.connected = false
  service.sharing.value = null
  service.heldPrompt.held.value = []
  service.settingsPrompt.staged.value = []
  service.listDevices.mockResolvedValue(null)
  service.status.value = { ...DISCONNECTED_STATUS }
  service.connection.value = emptyConnection()
  service.updateConnection.mockImplementation(async (patch: Partial<DeviceConnection>) =>
    change(patch)
  )
  service.pause.mockImplementation(() => change({ paused: true }))
  service.resume.mockImplementation(() => change({ paused: false }))
  client.state.mockResolvedValue({ head_seq: 7, settings: VAULT_SETTINGS, usage: USAGE })
  client.usage.mockResolvedValue(USAGE)
  client.updateSettings.mockResolvedValue(VAULT_SETTINGS)
  vi.spyOn(TokenSettingsPort, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  for (const screen of screens.splice(0)) screen.unmount()
  unhook()
  AbeleConfig.getInstance().destroy()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('what this device takes', () => {
  it('writes a switch to the connection, which is what tells the engine', async () => {
    const screen = open(SelectiveSync)

    await switchFor(screen, 'video').trigger('click')
    await flushPromises()

    expect(held().video).toBe(false)
    expect(service.updateConnection).toHaveBeenCalledWith({
      selective: expect.objectContaining({ video: false }),
    })
  })

  /** What a device syncs is its own; `data.json` is what other devices can be handed. */
  it('writes nothing to data.json', async () => {
    const config = AbeleConfig.getInstance()
    const saveSettings = vi.spyOn(config, 'saveSettings')
    const screen = open(SelectiveSync)

    await switchFor(screen, 'video').trigger('click')
    await flushPromises()

    expect(saveSettings).not.toHaveBeenCalled()
    expect(config.exportSettings().sync).toEqual({ keySignature: null })
  })

  /**
   * `AbeleConfig` is a plain class, so a screen reading through it redraws from nothing. The
   * switch that was clicked has to move, which is the whole of what a person sees.
   */
  it('moves the switch that was clicked', async () => {
    const screen = open(SelectiveSync)
    expect(switchFor(screen, 'video').props('isEnabled')).toBe(true)

    await switchFor(screen, 'video').trigger('click')
    await flushPromises()

    expect(switchFor(screen, 'video').props('isEnabled')).toBe(false)
  })

  it('rolls back a refused selective write and visibly reports the failure', async () => {
    const screen = open(SelectiveSync)
    service.updateConnection.mockRejectedValueOnce(new Error('storage unavailable'))
    await switchFor(screen, 'images').trigger('click')
    await flushPromises()
    expect(switchFor(screen, 'images').props('isEnabled')).toBe(held().images)
    expect(screen.text()).toContain('storage unavailable')
    expect(screen.text()).toContain('Nothing was changed')
  })

  it('takes a folder off the list the moment it is removed', async () => {
    change({ selective: { ...held(), excludedFolders: ['Archive/Video'] } })
    const screen = open(SelectiveSync)
    expect(screen.text()).toContain('Archive/Video')

    await screen
      .findAll('.abele-obsidian-icon')
      .find((icon) => icon.attributes('aria-label')?.startsWith('Sync this folder'))
      ?.trigger('click')
    await flushPromises()

    expect(screen.text()).not.toContain('Archive/Video')
    expect(held().excludedFolders).toEqual([])
  })

  /**
   * The agent or a transfer can change the connection while this screen is open. A screen still
   * holding the old switches would write them back over that on the very next click.
   */
  it('takes up a change made elsewhere rather than writing over it', async () => {
    const screen = open(SelectiveSync)

    change({ selective: { ...held(), images: false } })
    await flushPromises()

    expect(switchFor(screen, 'images').props('isEnabled')).toBe(false)

    await switchFor(screen, 'video').trigger('click')
    await flushPromises()

    expect(held().images).toBe(false)
    expect(held().video).toBe(false)
  })

  it('does the same for a settings category', async () => {
    const screen = open(SelectiveSync)

    await screen
      .find('[data-selective-settings="hotkeys"]')
      .findComponent(Checkbox)
      .trigger('click')
    await flushPromises()

    expect(held().settings.hotkeys).toBe(false)
    expect(service.updateConnection).toHaveBeenCalled()
  })

  /**
   * Core knows the config folder as `.obsidian` and nothing else, so a device whose folder was
   * renamed keeps it out of the sync. The switches would do nothing there; the screen says why.
   */
  it('says the settings stay put on a device whose config folder was renamed', async () => {
    const app = useVault([])
    app.vault.configDir = '.obsidian-mobile'
    const screen = open(SelectiveSync)

    expect(screen.text()).toContain('.obsidian-mobile')
    expect(screen.find('[data-selective-settings="hotkeys"]').exists()).toBe(false)
  })

  it('takes a cap in megabytes and keeps it in bytes', async () => {
    const screen = open(SelectiveSync)

    await screen.findAll('input')[0].setValue('50')
    await screen.findAll('input')[0].trigger('change')
    await flushPromises()

    expect(held().maxFileBytes).toBe(50 * 1024 * 1024)
  })

  /** No cap is a different answer from a cap of zero, and an empty field means the first. */
  it('reads an empty cap as no cap at all, once it is committed', async () => {
    change({ selective: { ...held(), maxFileBytes: 1024 } })
    const screen = open(SelectiveSync)

    await screen.findAll('input')[0].setValue('')
    await screen.findAll('input')[0].trigger('change')
    await flushPromises()

    expect(held().maxFileBytes).toBeNull()
  })

  /**
   * Every save that moves the cap rebuilds the engine and walks the manifest, and on a phone
   * editing 50 into 100 passes through an empty field — which, saved, is no cap at all, and a
   * rescan that starts downloading every video. Nothing is saved until the field is left.
   */
  it('saves nothing while the cap is being typed, an empty field included', async () => {
    change({ selective: { ...held(), maxFileBytes: 50 * 1024 * 1024 } })
    const screen = open(SelectiveSync)
    const field = screen.findAll('input')[0]

    await type(field, '')
    await type(field, '1')
    await type(field, '10')

    expect(held().maxFileBytes).toBe(50 * 1024 * 1024)
    expect(service.updateConnection).not.toHaveBeenCalled()

    await type(field, '100')
    await field.trigger('change')
    await flushPromises()

    expect(held().maxFileBytes).toBe(100 * 1024 * 1024)
    expect(service.updateConnection).toHaveBeenCalledTimes(1)
  })

  it('puts back what was saved when the field is left holding no number', async () => {
    change({ selective: { ...held(), maxFileBytes: 50 * 1024 * 1024 } })
    const screen = open(SelectiveSync)
    const field = screen.findAll('input')[0]

    await type(field, 'abc')
    await field.trigger('change')
    await flushPromises()

    expect(held().maxFileBytes).toBe(50 * 1024 * 1024)
    expect((field.element as HTMLInputElement).value).toBe('50')
    expect(service.updateConnection).not.toHaveBeenCalled()
  })

  /**
   * Escape closes the settings with the cap field still focused, and a field taken out of the
   * page fires no `change`. What was typed is kept if it is a cap — and an empty field never
   * is: saved on the way out, it would be no cap at all and a rescan nobody asked for.
   */
  it('keeps a cap typed into a field the settings closed on', async () => {
    change({ selective: { ...held(), maxFileBytes: 50 * 1024 * 1024 } })
    const screen = open(SelectiveSync)

    await type(screen.findAll('input')[0], '20')
    screen.unmount()
    await flushPromises()

    expect(held().maxFileBytes).toBe(20 * 1024 * 1024)
    expect(service.updateConnection).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['empty', ''],
    ['not a number', 'abc'],
    ['zero', '0'],
    ['unchanged', '50'],
  ])('saves nothing on the way out when the field is %s', async (_what, text) => {
    change({ selective: { ...held(), maxFileBytes: 50 * 1024 * 1024 } })
    const screen = open(SelectiveSync)

    await type(screen.findAll('input')[0], text)
    screen.unmount()
    await flushPromises()

    expect(held().maxFileBytes).toBe(50 * 1024 * 1024)
    expect(service.updateConnection).not.toHaveBeenCalled()
  })
})
