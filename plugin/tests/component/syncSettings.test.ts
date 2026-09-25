/**
 * The Sync tab.
 *
 * The engine itself is the sibling repo's and is tested there; what is asserted here is the
 * half a settings screen owes it. A device nobody has set up is offered a way to set it up and
 * nothing else. A device that is set up is shown what it is doing and what it is doing it to.
 * A switch that is ticked reaches `data.json` *and* the running engine — a save that never got
 * as far as the service would leave a person looking at a setting that is not in force.
 *
 * The service is a stand-in: it owns an IndexedDB, a WebSocket and a real server connection,
 * none of which a component test has any business opening. Its shape is the shape the real one
 * publishes, so a method renamed there fails to compile here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import SyncSettings from '@/components/settings/SyncSettings.vue'
import SelectiveSync from '@/components/settings/sync/SelectiveSync.vue'
import VaultPolicy from '@/components/settings/sync/VaultPolicy.vue'
import ConnectCard from '@/components/settings/sync/ConnectCard.vue'
import Section from '@/components/obsidian/Section.vue'
import Badge from '@/components/obsidian/Badge.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Button from '@/components/obsidian/Button.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import UsageCard from '@/components/settings/sync/UsageCard.vue'
import Card from '@/components/obsidian/Card.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService } from '@/sync/SyncService'
import { DISCONNECTED_STATUS, type SyncStatus } from '@/sync/status'
import { defaultSyncSettings } from '@/sync/settings'
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
  connected: false,
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
}

/** What `init` does in the running plugin: the service hears about every settings save. */
let unhook: () => void

const open = <T>(component: T, props: Record<string, unknown> = {}) =>
  mount(component as never, { props, global: { stubs: STUBS } })
type Screen = ReturnType<typeof open>

const headings = (screen: Screen): string[] =>
  screen.findAllComponents(Section).map((s) => s.props('title') as string)

const badgeTexts = (screen: Screen): string[] =>
  screen.findAllComponents(Badge).map((b) => b.props('text') as string)

const buttonNamed = (screen: Screen, text: string) =>
  screen.findAllComponents(Button).find((b) => b.props('text') === text)

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

  service.connected = false
  service.status.value = { ...DISCONNECTED_STATUS }
  client.state.mockResolvedValue({ head_seq: 7, settings: VAULT_SETTINGS, usage: USAGE })
  client.usage.mockResolvedValue(USAGE)
  client.updateSettings.mockResolvedValue(VAULT_SETTINGS)
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  unhook()
  AbeleConfig.getInstance().destroy()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** Puts the settings and the service into the state of a device that has been set up. */
function connect(): void {
  const sync = AbeleConfig.getInstance().sync
  sync.serverUrl = 'https://sync.example.com'
  sync.vaultId = 'v1'
  sync.deviceId = 'd1'
  sync.deviceName = 'Desktop — Notes'
  sync.deviceTokenId = 'abele-sync-device-1'
  service.connected = true
  service.status.value = {
    ...DISCONNECTED_STATUS,
    state: 'idle',
    lastSyncAt: new Date().toISOString(),
  }
}

describe('a device nobody has set up', () => {
  it('offers the connect card and nothing else', () => {
    const screen = open(SyncSettings)

    expect(screen.findComponent(ConnectCard).exists()).toBe(true)
    expect(headings(screen)).toEqual(['Connect to a server'])
  })

  it('does not show what a vault it cannot reach holds', () => {
    const screen = open(SyncSettings)

    expect(screen.findComponent(SelectiveSync).exists()).toBe(false)
    expect(screen.findComponent(VaultPolicy).exists()).toBe(false)
    expect(client.state).not.toHaveBeenCalled()
  })

  it('never puts the password anywhere but the field it was typed into', async () => {
    const screen = open(ConnectCard, { serverUrl: '' })
    const fields = screen.findAll('input')
    const password = fields.find((f) => f.attributes('type') === 'password')

    expect(password).toBeDefined()
    await password?.setValue('hunter2')

    expect(JSON.stringify(AbeleConfig.getInstance().sync)).not.toContain('hunter2')
  })
})

describe('a device that is set up', () => {
  it('says in one word what sync is doing', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    expect(badgeTexts(screen)).toContain('Fully synced')
  })

  it('names the server, the vault and the device it enrolled as', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    const values = screen.findAll('.abele-sync-settings__value').map((v) => v.text())
    expect(values).toEqual(['https://sync.example.com', 'v1', 'Desktop — Notes'])
  })

  /**
   * A badge never wraps and never shrinks, so a server address in one pushes a phone-width
   * pane sideways. Only the status word is short enough to be one.
   */
  it('keeps the badge for the status word and lets the long values wrap', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    const badges = badgeTexts(screen)
    expect(badges).toContain('Fully synced')
    expect(badges).not.toContain('https://sync.example.com')
    expect(badges).not.toContain('v1')
    expect(badges).not.toContain('Desktop — Notes')
  })

  it('shows what it syncs, the vault policy and what the vault holds', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    expect(headings(screen)).toEqual(
      expect.arrayContaining([
        'This device',
        'What this device syncs',
        'Vault policy',
        'What the vault holds',
      ])
    )
  })

  it('offers no connect card once there is nothing left to connect', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    expect(screen.findComponent(ConnectCard).exists()).toBe(false)
  })

  it('asks before it disconnects, rather than doing it on the click', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    await buttonNamed(screen, 'Disconnect')?.trigger('click')

    expect(service.disconnect).not.toHaveBeenCalled()
    expect(screen.findComponent(ConfirmModal).props('message')).toContain('Not one file is deleted')
  })

  it('disconnects once the question has been answered', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()
    await buttonNamed(screen, 'Disconnect')?.trigger('click')

    screen.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(service.disconnect).toHaveBeenCalled()
  })

  /** Forgetting throws away a ledger, not a note, and the question has to say which. */
  it('says what forgetting costs, which is not the files', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    await buttonNamed(screen, 'Forget')?.trigger('click')

    expect(screen.findComponent(ConfirmModal).props('message')).toContain('No file is deleted')
  })

  it('syncs on demand', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    await buttonNamed(screen, 'Sync now')?.trigger('click')

    expect(service.syncNow).toHaveBeenCalled()
  })

  it('offers Resume rather than Pause once it is paused', async () => {
    connect()
    AbeleConfig.getInstance().sync.paused = true
    const screen = open(SyncSettings)
    await flushPromises()

    expect(buttonNamed(screen, 'Pause')).toBeUndefined()
    await buttonNamed(screen, 'Resume')?.trigger('click')
    expect(service.resume).toHaveBeenCalled()
  })

  /**
   * The engine does not publish `paused` until a run in flight has finished, so a screen that
   * waited for the status would go on offering Pause for as long as the sync takes. What the
   * person pressed is true the moment they press it.
   */
  it('says it is paused the moment Pause is pressed, mid-sync or not', async () => {
    connect()
    service.status.value = { ...service.status.value, state: 'syncing', pending: 3 }
    const screen = open(SyncSettings)
    await flushPromises()

    await buttonNamed(screen, 'Pause')?.trigger('click')
    await flushPromises()

    expect(service.pause).toHaveBeenCalled()
    expect(buttonNamed(screen, 'Resume')).toBeDefined()
    expect(buttonNamed(screen, 'Pause')).toBeUndefined()
  })
})

describe('what this device takes', () => {
  it('writes a switch to the settings and tells the engine about it', async () => {
    const screen = open(SelectiveSync)

    await switchFor(screen, 'video').trigger('click')
    await flushPromises()

    expect(AbeleConfig.getInstance().sync.selective.video).toBe(false)
    // The save is what reaches the engine; nothing here calls the service itself.
    expect(service.onSettingsSaved).toHaveBeenCalled()
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

  it('takes a folder off the list the moment it is removed', async () => {
    AbeleConfig.getInstance().sync.selective.excludedFolders = ['Archive/Video']
    const screen = open(SelectiveSync)
    expect(screen.text()).toContain('Archive/Video')

    await screen
      .findAll('.abele-obsidian-icon')
      .find((icon) => icon.attributes('aria-label')?.startsWith('Sync this folder'))
      ?.trigger('click')
    await flushPromises()

    expect(screen.text()).not.toContain('Archive/Video')
    expect(AbeleConfig.getInstance().sync.selective.excludedFolders).toEqual([])
  })

  /**
   * A transfer landing replaces the whole settings object. A screen still holding the old one
   * would write it back over what arrived on the very next click.
   */
  it('takes up what a transfer wrote rather than writing over it', async () => {
    const config = AbeleConfig.getInstance()
    const screen = open(SelectiveSync)

    config.sync = { ...config.sync, selective: { ...config.sync.selective, images: false } }
    await config.saveSettings()
    await flushPromises()

    expect(switchFor(screen, 'images').props('isEnabled')).toBe(false)

    await switchFor(screen, 'video').trigger('click')
    await flushPromises()

    expect(config.sync.selective.images).toBe(false)
    expect(config.sync.selective.video).toBe(false)
  })

  it('does the same for a settings category', async () => {
    const screen = open(SelectiveSync)

    await screen
      .find('[data-selective-settings="hotkeys"]')
      .findComponent(Checkbox)
      .trigger('click')
    await flushPromises()

    expect(AbeleConfig.getInstance().sync.selective.settings.hotkeys).toBe(false)
    expect(service.onSettingsSaved).toHaveBeenCalled()
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
    await flushPromises()

    expect(AbeleConfig.getInstance().sync.selective.maxFileBytes).toBe(50 * 1024 * 1024)
  })

  /** No cap is a different answer from a cap of zero, and an empty field means the first. */
  it('reads an empty cap as no cap at all', async () => {
    AbeleConfig.getInstance().sync.selective.maxFileBytes = 1024
    const screen = open(SelectiveSync)

    await screen.findAll('input')[0].setValue('')
    await flushPromises()

    expect(AbeleConfig.getInstance().sync.selective.maxFileBytes).toBeNull()
  })
})

describe('the vault policy', () => {
  it('reads what the server holds when it opens', async () => {
    service.connected = true
    open(VaultPolicy)
    await flushPromises()

    expect(client.state).toHaveBeenCalled()
  })

  it('patches only the fields it owns', async () => {
    service.connected = true
    const screen = open(VaultPolicy)
    await flushPromises()

    await buttonNamed(screen, 'Save policy')?.trigger('click')
    await flushPromises()

    expect(client.updateSettings).toHaveBeenCalledWith({ conflict: 'merge', key_signature: null })
  })

  it('sends the key signature the person filled in', async () => {
    service.connected = true
    const screen = open(VaultPolicy)
    await flushPromises()

    await screen.findAllComponents(Checkbox)[0].trigger('click')
    const fields = screen.findAll('input')
    await fields[0].setValue('private')
    await fields[1].setValue('true')
    await buttonNamed(screen, 'Save policy')?.trigger('click')
    await flushPromises()

    expect(client.updateSettings).toHaveBeenCalledWith({
      conflict: 'merge',
      key_signature: { enabled: true, property: 'private', value: 'true' },
    })
  })

  /** Half a signature would name every note or none of them, so half is sent as none. */
  it('sends nothing at all for a signature with no property', async () => {
    service.connected = true
    const screen = open(VaultPolicy)
    await flushPromises()

    await screen.findAllComponents(Checkbox)[0].trigger('click')
    await buttonNamed(screen, 'Save policy')?.trigger('click')
    await flushPromises()

    expect(client.updateSettings).toHaveBeenCalledWith({ conflict: 'merge', key_signature: null })
  })

  it('says so rather than sitting empty when the server cannot be reached', async () => {
    service.connected = true
    client.state.mockRejectedValue(new Error('the server never answered'))
    const screen = open(VaultPolicy)
    await flushPromises()

    expect(screen.text()).toContain('the server never answered')
  })
})

describe('what the vault holds', () => {
  it('says where the room goes: live, history and trash', async () => {
    service.connected = true
    const screen = open(UsageCard)
    await flushPromises()

    const badges = badgeTexts(screen)
    expect(badges).toContain('4.0 KB')
    expect(badges).toContain('2.0 KB')
    expect(badges).toContain('512 B')
  })

  it('counts the files of each kind the vault actually holds', async () => {
    service.connected = true
    const screen = open(UsageCard)
    await flushPromises()

    expect(screen.find('[data-usage-kind="note"]').text()).toContain('12 files')
    // A kind with nothing in it is not a row saying zero.
    expect(screen.find('[data-usage-kind="canvas"]').exists()).toBe(false)
  })

  it('names the heaviest histories', async () => {
    service.connected = true
    const screen = open(UsageCard)
    await flushPromises()

    expect(screen.findAllComponents(Card).map((c) => c.props('title'))).toEqual(['Notes/heavy.md'])
  })

  /** No route trims a history yet, so there is no button offering to. */
  it('offers no button it cannot honour', async () => {
    service.connected = true
    const screen = open(UsageCard)
    await flushPromises()

    expect(screen.findAllComponents(Button)).toHaveLength(0)
  })

  it('leaves the list out when the server named no heavy histories', async () => {
    service.connected = true
    client.usage.mockResolvedValue({ ...USAGE, top: [] })
    const screen = open(UsageCard)
    await flushPromises()

    expect(screen.findAllComponents(Card)).toHaveLength(0)
    expect(screen.text()).not.toContain('The heaviest histories')
  })
})
