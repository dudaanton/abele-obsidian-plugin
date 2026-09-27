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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import SyncSettings from '@/components/settings/SyncSettings.vue'
import SelectiveSync from '@/components/settings/sync/SelectiveSync.vue'
import VaultPolicy from '@/components/settings/sync/VaultPolicy.vue'
import ConnectCard from '@/components/settings/sync/ConnectCard.vue'
import Section from '@/components/obsidian/Section.vue'
import Setting from '@/components/obsidian/Setting.vue'
import { Notice } from 'obsidian'
import Badge from '@/components/obsidian/Badge.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Button from '@/components/obsidian/Button.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import UsageCard from '@/components/settings/sync/UsageCard.vue'
import JoinVaultModal from '@/components/settings/sync/JoinVaultModal.vue'
import type { JoinQuestion } from '@/sync/join'
import Card from '@/components/obsidian/Card.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SyncService } from '@/sync/SyncService'
import { DISCONNECTED_STATUS, type SyncStatus } from '@/sync/status'
import { defaultSyncSettings } from '@/sync/settings'
import { emptyConnection, type DeviceConnection } from '@/sync/connection'
import { PLAIN_HTTP_REFUSED, type ChangeItem } from '@abele/sync-protocol'
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
  heldPrompt: { held: ref<{ path: string; fileId: string }[]>([]) },
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

const open = <T>(component: T, props: Record<string, unknown> = {}) =>
  mount(component as never, { props, global: { stubs: STUBS } })
type Screen = ReturnType<typeof open>

const headings = (screen: Screen): string[] =>
  screen.findAllComponents(Section).map((s) => s.props('title') as string)

const badgeTexts = (screen: Screen): string[] =>
  screen.findAllComponents(Badge).map((b) => b.props('text') as string)

const buttonNamed = (screen: Screen, text: string) =>
  screen.findAllComponents(Button).find((b) => b.props('text') === text)

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

  service.connected = false
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
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  unhook()
  AbeleConfig.getInstance().destroy()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** Puts the service into the state of a device that has been set up. */
function connect(): void {
  change({
    serverUrl: 'https://sync.example.com',
    vaultId: 'v1',
    deviceId: 'd1',
    deviceName: 'Desktop — Notes',
    deviceTokenId: 'abele-sync-device-1',
    migrated: true,
  })
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

  /**
   * Signing in hands back an account token that can enrol devices, held in memory until a vault
   * is picked. Someone who signs in and walks away from the tab must not leave it there.
   */
  it('lets go of the account sign-in when the tab closes', () => {
    const screen = open(SyncSettings)

    screen.unmount()

    expect(service.endConnect).toHaveBeenCalled()
  })

  it('never puts the password anywhere but the field it was typed into', async () => {
    const screen = open(ConnectCard, { serverUrl: '' })
    const fields = screen.findAll('input')
    const password = fields.find((f) => f.attributes('type') === 'password')

    expect(password).toBeDefined()
    await password?.setValue('hunter2')

    expect(JSON.stringify(AbeleConfig.getInstance().exportSettings())).not.toContain('hunter2')
    expect(JSON.stringify(service.connection.value)).not.toContain('hunter2')
  })

  /**
   * The device token travels in every request, so plain http to another machine hands it to
   * anyone on the way. Said under the field as it is typed, not after a sign-in that failed.
   */
  it('refuses plain http to another machine before anyone presses Sign in', async () => {
    const screen = open(ConnectCard, { serverUrl: '' })
    const [address, email] = screen.findAll('input')
    await type(email!, 'me@example.com')
    await type(screen.find('input[type="password"]'), 'hunter2')

    await type(address!, 'http://192.168.1.5:8787')

    expect(screen.text()).toContain(PLAIN_HTTP_REFUSED)
    expect(buttonNamed(screen, 'Sign in')?.props('disabled')).toBe(true)

    await type(address!, 'http://localhost:8787')

    expect(screen.text()).not.toContain(PLAIN_HTTP_REFUSED)
    expect(buttonNamed(screen, 'Sign in')?.props('disabled')).toBe(false)
  })
})

/**
 * A sign-in first tells any server a device left while offline, waiting up to one revoke's
 * timeout. The card says who it is telling, so a pause there does not read as a hang.
 */
describe('a sign-in with a device still to be told about', () => {
  it('says who it is telling while the enrolment waits on it', async () => {
    service.connect.mockResolvedValue([
      {
        id: 'v1',
        name: 'Home',
        role: 'owner',
        usage: { live_bytes: 0, quota_bytes: null },
      },
    ])
    service.joinQuestion.mockResolvedValue({
      kind: 'upload',
      vaultName: 'Home',
      here: { files: 3, settings: 0 },
      there: { files: 0, settings: 0 },
    })
    let enrolled: () => void = () => undefined
    service.chooseVault.mockImplementation(
      () => new Promise<void>((resolve) => (enrolled = resolve))
    )
    const screen = open(ConnectCard, { serverUrl: 'https://sync.example.com' })
    const [, email] = screen.findAll('input')
    await type(email!, 'me@example.com')
    await type(screen.find('input[type="password"]'), 'hunter2')
    await buttonNamed(screen, 'Sign in')?.trigger('click')
    await flushPromises()

    await screen.findAllComponents(Card)[0]!.trigger('click')
    await flushPromises()
    screen
      .findComponent(JoinVaultModal)
      .vm.$emit('connect', { prefer: undefined, deviceName: 'Desktop — Home' })
    service.telling.value = 'Telling https://sync.example.com that Old laptop left…'
    await flushPromises()

    expect(screen.findComponent(JoinVaultModal).props('hint')).toBe(
      'Telling https://sync.example.com that Old laptop left…'
    )
    service.telling.value = null
    enrolled()
    await flushPromises()
    expect(screen.findComponent(JoinVaultModal).exists()).toBe(false)
  })
})

/**
 * Choosing a vault asks first (phase 3b, decision 7). The tap counts both sides and opens the
 * join dialog; only its Connect enrols, with the name and the side it was given, and closing it
 * enrols nothing. A vault made here asks nothing: it holds no file to decide about.
 */
describe('choosing a vault', () => {
  const VAULTS = [
    {
      id: 'v1',
      name: 'Home',
      role: 'owner',
      usage: { live_bytes: 0, quota_bytes: null, by_kind: { note: { live_bytes: 1, count: 5 } } },
    },
  ]
  const ASKED: JoinQuestion = {
    kind: 'choose',
    vaultName: 'Home',
    here: { files: 3, settings: 0 },
    there: { files: 5, settings: 0 },
  }

  async function signedIn(): Promise<Screen> {
    service.connect.mockResolvedValue(VAULTS)
    service.joinQuestion.mockResolvedValue(ASKED)
    const screen = open(ConnectCard, { serverUrl: 'https://sync.example.com' })
    const [, email] = screen.findAll('input')
    await type(email!, 'me@example.com')
    await type(screen.find('input[type="password"]'), 'hunter2')
    await buttonNamed(screen, 'Sign in')?.trigger('click')
    await flushPromises()
    return screen
  }

  const vaultCard = (screen: Screen) =>
    screen.findAllComponents(Card).find((card) => card.props('title') === 'Home')!

  it('asks before it enrols, with the question for that vault', async () => {
    const screen = await signedIn()

    await vaultCard(screen).trigger('click')
    await flushPromises()

    expect(service.joinQuestion).toHaveBeenCalledWith(VAULTS[0])
    expect(service.chooseVault).not.toHaveBeenCalled()
    const modal = screen.findComponent(JoinVaultModal)
    expect(modal.props('question')).toEqual(ASKED)
    expect(modal.props('deviceName')).toMatch(/Home$/)
  })

  it('no longer asks for the device name before a vault is chosen', async () => {
    const screen = await signedIn()

    expect(screen.findAllComponents(Setting).map((row) => row.props('name'))).not.toContain(
      "This device's name"
    )
  })

  it('enrols with the side and the name the dialog was given', async () => {
    const screen = await signedIn()
    await vaultCard(screen).trigger('click')
    await flushPromises()

    screen
      .findComponent(JoinVaultModal)
      .vm.$emit('connect', { prefer: 'theirs', deviceName: 'Work laptop' })
    await flushPromises()

    expect(service.chooseVault).toHaveBeenCalledWith('v1', 'Work laptop', 'theirs')
    expect(screen.findComponent(JoinVaultModal).exists()).toBe(false)
  })

  it('enrols nothing when the dialog is closed', async () => {
    const screen = await signedIn()
    await vaultCard(screen).trigger('click')
    await flushPromises()

    screen.findComponent(JoinVaultModal).vm.$emit('close')
    await flushPromises()

    expect(service.chooseVault).not.toHaveBeenCalled()
    expect(screen.findComponent(JoinVaultModal).exists()).toBe(false)
    expect(vaultCard(screen).props('selected')).toBe(false)
  })

  it('keeps the dialog open with the reason when the enrolment fails', async () => {
    const screen = await signedIn()
    service.chooseVault.mockRejectedValue(new Error('the server said no'))
    await vaultCard(screen).trigger('click')
    await flushPromises()

    screen
      .findComponent(JoinVaultModal)
      .vm.$emit('connect', { prefer: null, deviceName: 'Desktop — Home' })
    await flushPromises()

    expect(screen.findComponent(JoinVaultModal).props('error')).toBe('the server said no')
  })

  /**
   * Obsidian closes a dialog on Escape or a tap beside it whatever the component thinks, so a
   * close while the connect runs must leave nothing half open: the next tap opens a dialog.
   */
  it('opens a new dialog on the next tap after one was closed while it connected', async () => {
    const screen = await signedIn()
    let refuse!: (error: Error) => void
    service.chooseVault.mockImplementation(
      () => new Promise<void>((_resolve, reject) => (refuse = reject))
    )
    await vaultCard(screen).trigger('click')
    await flushPromises()
    const first = screen.findComponent(JoinVaultModal)
    first.vm.$emit('connect', { prefer: null, deviceName: 'Desktop — Home' })
    await flushPromises()

    first.vm.$emit('close')
    await flushPromises()
    expect(screen.findComponent(JoinVaultModal).exists()).toBe(false)
    refuse(new Error('the server said no'))
    await flushPromises()
    expect(screen.text()).toContain('the server said no')

    await vaultCard(screen).trigger('click')
    await flushPromises()
    const second = screen.findComponent(JoinVaultModal)
    expect(second.exists()).toBe(true)
    expect(second.vm.$.uid).not.toBe(first.vm.$.uid)
  })

  it('says why on the card when the files could not be counted, and opens nothing', async () => {
    const screen = await signedIn()
    service.joinQuestion.mockRejectedValue(new Error('.abele-sync-ignore could not be read'))

    await vaultCard(screen).trigger('click')
    await flushPromises()

    expect(screen.findComponent(JoinVaultModal).exists()).toBe(false)
    expect(screen.text()).toContain('.abele-sync-ignore could not be read')
    expect(vaultCard(screen).props('selected')).toBe(false)
  })

  it('makes a new vault without asking, under the name on its card', async () => {
    const screen = await signedIn()
    const card = screen
      .findAllComponents(Card)
      .find((c) => c.props('title') === 'Create a new vault')!
    const [vaultName, deviceName] = card.findAll('input')
    await type(vaultName!, 'Notes')
    expect((deviceName!.element as HTMLInputElement).value).toMatch(/Notes$/)
    await type(deviceName!, 'Studio')

    await buttonNamed(screen, 'Create and connect')?.trigger('click')
    await flushPromises()

    expect(service.joinQuestion).not.toHaveBeenCalled()
    expect(screen.findComponent(JoinVaultModal).exists()).toBe(false)
    expect(service.chooseVault).toHaveBeenCalledWith({ create: 'Notes' }, 'Studio')
  })
})

/**
 * A transfer connected this device to a vault, and both may hold files: nothing syncs until the
 * join question is answered. The tab asks by itself, and is where the question is found again.
 */
describe('deletions held back', () => {
  it('shows the question on the tab for as long as they are held', async () => {
    connect()
    service.heldPrompt.held.value = [
      { path: 'Notes/a.md', fileId: 'f1' },
      { path: 'Notes/b.md', fileId: 'f2' },
    ]

    const screen = open(SyncSettings)
    await flushPromises()

    expect(headings(screen)).toContain('Deletions held back')
    expect(buttonNamed(screen, 'Put them back')).toBeDefined()

    service.heldPrompt.held.value = []
    await flushPromises()
    expect(headings(screen)).not.toContain('Deletions held back')
  })

  it('shows nothing of it while nothing is held', async () => {
    connect()

    const screen = open(SyncSettings)
    await flushPromises()

    expect(headings(screen)).not.toContain('Deletions held back')
  })
})

describe('the devices on this vault', () => {
  it('are listed on the tab of a connected device, beside this one', async () => {
    connect()
    service.listDevices.mockResolvedValue([
      {
        id: service.connection.value.deviceId,
        name: 'Mac',
        platform: 'desktop',
        vault_id: 'v1',
        created_at: '2026-09-01T10:00:00.000Z',
        last_seen_at: null,
        enrolled_by: null,
      },
    ] as never)

    const screen = open(SyncSettings)
    await flushPromises()

    expect(headings(screen)).toContain('Devices on this vault')
    expect(badgeTexts(screen)).toContain('This device')
  })
})

describe('settings from another device', () => {
  const staged = (path: string): ChangeItem => ({
    seq: 1,
    file_id: `f-${path}`,
    op: 'modify',
    path,
    prev_path: null,
    sha: 'a'.repeat(64),
    size: 2,
    mtime: 1,
    version_id: `v-${path}`,
    kind: 'config',
    actor: { kind: 'device', id: 'd1', name: 'Laptop' },
    at: '2026-09-27T10:00:00.000Z',
  })

  it('wait on the tab with Apply and reload for as long as they are staged', async () => {
    connect()
    service.settingsPrompt.staged.value = [
      staged('.obsidian/app.json'),
      staged('.obsidian/hotkeys.json'),
    ]

    const screen = open(SyncSettings)
    await flushPromises()

    expect(headings(screen)).toContain('Settings waiting (2)')
    expect(buttonNamed(screen, 'Apply and reload')).toBeDefined()
    expect(buttonNamed(screen, "Keep this device's")).toBeDefined()

    service.settingsPrompt.staged.value = []
    await flushPromises()
    expect(headings(screen).some((title) => title.startsWith('Settings waiting'))).toBe(false)
  })
})

describe('a device waiting to join', () => {
  const ASKED: JoinQuestion = {
    kind: 'choose',
    vaultName: 'Home',
    here: { files: 3, settings: 0 },
    there: { files: 5, settings: 0 },
  }

  function waiting(): void {
    connect()
    change({ vaultName: 'Home', join: { vaultId: 'v1', prefer: null, ask: true } })
    service.connected = false
    service.status.value = { ...DISCONNECTED_STATUS, state: 'joining' }
    service.joinQuestion.mockResolvedValue(ASKED)
    service.answerJoin.mockResolvedValue(undefined)
  }

  it('asks the question as the tab opens, with no name to give', async () => {
    waiting()

    const screen = open(SyncSettings)
    await flushPromises()

    expect(service.joinQuestion).toHaveBeenCalledWith()
    const modal = screen.findComponent(JoinVaultModal)
    expect(modal.props('question')).toEqual(ASKED)
    expect(modal.props('deviceName')).toBeUndefined()
  })

  it('answers with the side chosen, and closes', async () => {
    waiting()
    const screen = open(SyncSettings)
    await flushPromises()

    screen.findComponent(JoinVaultModal).vm.$emit('connect', { prefer: 'mine', deviceName: '' })
    await flushPromises()

    expect(service.answerJoin).toHaveBeenCalledWith('mine')
    expect(screen.findComponent(JoinVaultModal).exists()).toBe(false)
  })

  it('keeps waiting when the dialog is closed, and asks again from the tab', async () => {
    waiting()
    const screen = open(SyncSettings)
    await flushPromises()

    screen.findComponent(JoinVaultModal).vm.$emit('close')
    await flushPromises()
    expect(service.answerJoin).not.toHaveBeenCalled()
    expect(headings(screen)).toContain('Choose how to join')

    await buttonNamed(screen, 'Choose…')?.trigger('click')
    await flushPromises()
    expect(screen.findComponent(JoinVaultModal).exists()).toBe(true)
  })

  it('closes at once when closed while it answers, and opens a new dialog from the tab', async () => {
    waiting()
    let refuse!: (error: Error) => void
    service.answerJoin.mockImplementation(
      () => new Promise<void>((_resolve, reject) => (refuse = reject))
    )
    const screen = open(SyncSettings)
    await flushPromises()
    const first = screen.findComponent(JoinVaultModal)
    first.vm.$emit('connect', { prefer: 'mine', deviceName: '' })
    await flushPromises()

    first.vm.$emit('close')
    await flushPromises()
    expect(screen.findComponent(JoinVaultModal).exists()).toBe(false)
    refuse(new Error('the server said no'))
    await flushPromises()
    expect(screen.text()).toContain('the server said no')

    await buttonNamed(screen, 'Choose…')?.trigger('click')
    await flushPromises()
    const second = screen.findComponent(JoinVaultModal)
    expect(second.exists()).toBe(true)
    expect(second.vm.$.uid).not.toBe(first.vm.$.uid)
  })

  it('offers what this device takes and leaving, not what needs a running sync', async () => {
    waiting()

    const screen = open(SyncSettings)
    await flushPromises()

    expect(screen.findComponent(SelectiveSync).exists()).toBe(true)
    expect(screen.findComponent(VaultPolicy).exists()).toBe(false)
    expect(screen.findComponent(UsageCard).exists()).toBe(false)
    expect(buttonNamed(screen, 'Sync now')).toBeUndefined()
    expect(buttonNamed(screen, 'Disconnect')).toBeDefined()
  })

  it('says why when the question could not be prepared', async () => {
    waiting()
    service.joinQuestion.mockRejectedValue(new Error('.abele-sync-ignore could not be read'))

    const screen = open(SyncSettings)
    await flushPromises()

    expect(screen.findComponent(JoinVaultModal).exists()).toBe(false)
    expect(screen.text()).toContain('.abele-sync-ignore could not be read')
  })
})

/**
 * A Disconnect that could not reach the server keeps the token to tell it later. The tab says so
 * on either screen, and offers to stop waiting — which is the person's call, not a timer's alone.
 */
describe('a device the server has not been told about', () => {
  const waiting = {
    serverUrl: 'https://sync.example.com',
    deviceId: 'd0',
    deviceName: 'Old laptop',
    tokenId: 'abele-sync-device-revoke-0',
    since: '2026-09-01T00:00:00.000Z',
    plainHttp: false,
  }

  it('tries to tell the server again as the tab opens', () => {
    open(SyncSettings)

    expect(service.retryPendingRevokes).toHaveBeenCalledTimes(1)
  })

  it('says which device the server does not yet know left, on the sign-in screen too', () => {
    change({ pendingRevoke: [waiting] })
    const screen = open(SyncSettings)

    const row = screen
      .findAllComponents(Setting)
      .find((r) => r.props('name') === 'Waiting to tell the server')
    expect(row).toBeTruthy()
    expect(row!.props('desc')).toContain(
      'The server has not been told that Old laptop left https://sync.example.com. It will be retried.'
    )
    expect(buttonNamed(screen, 'Forget without telling the server')).toBeTruthy()
  })

  it('asks before it forgets the kept token, naming the device and the server', async () => {
    change({ pendingRevoke: [waiting] })
    const screen = open(SyncSettings)

    await buttonNamed(screen, 'Forget without telling the server')?.trigger('click')

    expect(service.forgetPendingRevoke).not.toHaveBeenCalled()
    const message = screen.findComponent(ConfirmModal).props('message') as string
    expect(message).toContain('Old laptop')
    expect(message).toContain('https://sync.example.com')
    screen.findComponent(ConfirmModal).vm.$emit('close')
    await flushPromises()
    expect(service.forgetPendingRevoke).not.toHaveBeenCalled()
  })

  it('stops waiting when asked, and only for that device', async () => {
    change({ pendingRevoke: [waiting, { ...waiting, tokenId: 'abele-sync-device-revoke-1' }] })
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    await screen
      .findAllComponents(Button)
      .filter((b) => b.props('text') === 'Forget without telling the server')[1]!
      .trigger('click')
    screen.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(service.forgetPendingRevoke).toHaveBeenCalledTimes(1)
    expect(service.forgetPendingRevoke).toHaveBeenCalledWith('abele-sync-device-revoke-1')
  })

  /**
   * A connection made over plain http to another machine before the https rule: the token is
   * never sent that way, so this one is not waiting on anything — and the line must not say it
   * will be retried.
   */
  it('says a device on plain http cannot be told, and offers only to forget it', () => {
    change({
      pendingRevoke: [{ ...waiting, serverUrl: 'http://192.168.1.5:8787', plainHttp: true }],
    })
    const screen = open(SyncSettings)

    const row = screen
      .findAllComponents(Setting)
      .find((r) => r.props('name') === 'Cannot tell the server')
    expect(row).toBeTruthy()
    expect(row!.props('desc')).toContain('cannot be told over plain http')
    expect(row!.props('desc')).not.toContain('retried')
    expect(buttonNamed(screen, 'Forget without telling the server')).toBeTruthy()
  })

  it('says nothing when nothing is waiting', () => {
    const screen = open(SyncSettings)

    expect(buttonNamed(screen, 'Forget without telling the server')).toBeUndefined()
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

  /**
   * A build that failed leaves no engine, and the reason is in the status. A screen that read
   * "no engine" as "nobody set this up" would offer the sign-in card and never say why.
   */
  it('says why sync could not start, rather than offering to sign in again', async () => {
    connect()
    service.connected = false
    service.status.value = {
      ...DISCONNECTED_STATUS,
      state: 'error',
      lastError: 'the state database would not open',
    }
    const screen = open(SyncSettings)
    await flushPromises()

    expect(screen.findComponent(ConnectCard).exists()).toBe(false)
    expect(screen.text()).toContain('the state database would not open')
  })

  it('follows the service when it stops, without anything on this screen asking', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    service.connected = false
    service.status.value = { ...DISCONNECTED_STATUS }
    await flushPromises()

    expect(screen.findComponent(ConnectCard).exists()).toBe(true)
  })

  /**
   * A save that moves what the device syncs rebuilds the engine, which says `syncing` and then
   * settles — never `disconnected` (the service's own test holds it to that). The tab stays put
   * through it, so a switch clicked as the cap field loses focus still lands.
   */
  it('stays put through a rebuild, so a switch clicked after the cap still lands', async () => {
    connect()
    service.updateConnection.mockImplementation(async (patch: Partial<DeviceConnection>) => {
      change(patch)
      service.status.value = { ...service.status.value, state: 'syncing' }
    })
    const screen = open(SyncSettings)
    await flushPromises()
    const selective = screen.findComponent(SelectiveSync)
    const mounted = selective.vm.$.uid

    const field = selective.findAll('input')[0]
    await type(field, '10')
    await field.trigger('change')
    await flushPromises()
    service.status.value = { ...service.status.value, state: 'idle' }
    await switchFor(screen, 'pdf').trigger('click')
    await flushPromises()

    expect(screen.findComponent(ConnectCard).exists()).toBe(false)
    // The same instance, not one mounted again after the sign-in card came and went.
    expect(screen.findComponent(SelectiveSync).vm.$.uid).toBe(mounted)
    expect(held().maxFileBytes).toBe(10 * 1024 * 1024)
    expect(held().pdf).toBe(false)
  })

  it('shows a connection the service changed, whoever asked it to', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    change({ serverUrl: 'https://elsewhere.example.com' })
    await flushPromises()

    expect(screen.text()).toContain('https://elsewhere.example.com')
  })

  /**
   * Another device's `data.json`, arriving with an older build's connection in it, names no
   * connection this device reads: the tab goes on showing its own.
   */
  it('shows its own server whatever a data.json reloaded from disk names', async () => {
    connect()
    const screen = open(SyncSettings)
    await flushPromises()

    const config = AbeleConfig.getInstance()
    config.applySettings({ sync: { serverUrl: 'https://elsewhere.example.com' } } as never)
    config.version.value++
    await flushPromises()

    expect(screen.text()).toContain('https://sync.example.com')
    expect(screen.text()).not.toContain('https://elsewhere.example.com')
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
    expect(screen.findComponent(ConfirmModal).props('message')).toBe(
      'The server will stop accepting this device. Connecting again needs the password. ' +
        'Files are not touched.'
    )
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
    // Forget runs through Disconnect, so it tells the server too.
    expect(screen.findComponent(ConfirmModal).props('message')).toMatch(
      /^The server will stop accepting this device\. Connecting again needs the password\./
    )
  })

  it('says why, when the Disconnect was refused', async () => {
    connect()
    service.disconnect.mockRejectedValue(new Error('this device stays connected'))
    Notice.shown.length = 0
    const screen = open(SyncSettings)
    await flushPromises()
    await buttonNamed(screen, 'Disconnect')?.trigger('click')

    screen.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(Notice.shown.join('\n')).toContain('this device stays connected')
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
    change({ paused: true })
    const screen = open(SyncSettings)
    await flushPromises()

    expect(buttonNamed(screen, 'Pause')).toBeUndefined()
    await buttonNamed(screen, 'Resume')?.trigger('click')
    expect(service.resume).toHaveBeenCalled()
  })

  it('does not offer Sync now while paused, and says to resume instead', async () => {
    connect()
    change({ paused: true })
    const screen = open(SyncSettings)
    await flushPromises()

    expect(buttonNamed(screen, 'Sync now')?.props('disabled')).toBe(true)
    expect(buttonNamed(screen, 'Sync now')?.props('tooltip')).toContain('Resume')
    expect(buttonNamed(screen, 'Rescan')?.props('disabled')).toBe(true)
  })

  it('says a sync is sending what it found, and what is still waiting once it is over', async () => {
    connect()
    service.status.value = { ...service.status.value, state: 'syncing', pending: 3 }
    const screen = open(SyncSettings)
    await flushPromises()
    expect(screen.text()).toContain('Sending the 3 changes this sync found.')
    expect(screen.text()).not.toContain('Fully synced')

    service.status.value = { ...service.status.value, state: 'idle', pending: 2 }
    await flushPromises()
    expect(screen.text()).toContain('2 changes are waiting to be sent.')
    expect(screen.text()).not.toContain('Fully synced')
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
