/**
 * The sync connection in a settings transfer, on both screens.
 *
 * Sending: a connected device offers its connection, and when keys go it asks the server for a
 * device of the other side's own — once, at the moment the codes are made, under a name the
 * person gives it. Receiving: a device that syncs nothing takes it; one that already syncs that
 * vault skips it; one that syncs another vault is asked before it is switched. Whatever is not
 * taken is revoked, so no device is left on the server that nobody holds.
 *
 * The service is a stand-in: what is asserted is what the screens ask of it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { EngineError } from '@abele/sync-core'
import TransferSettings from '@/components/settings/TransferSettings.vue'
import TransferScanModal from '@/components/settings/transfer/TransferScanModal.vue'
import TransferSendModal from '@/components/settings/transfer/TransferSendModal.vue'
import Input from '@/components/obsidian/Input.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Button from '@/components/obsidian/Button.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@/ai/types'
import { SyncService } from '@/sync/SyncService'
import { emptyConnection, type DeviceConnection } from '@/sync/connection'
import { DISCONNECTED_STATUS } from '@/sync/status'
import { createReceiver, newTransferId, toText } from '@/transfer/frames'
import { decodePayload, encodePayload } from '@/transfer/payload'
import { buildPayload, collectEntries } from '@/transfer/entries'
import { CONNECTION_TOKEN, connectionEntry, withSibling } from '@/transfer/connection'
import type { TransferPayload } from '@/transfer/types'
import { useVault } from '../helpers/testEnv'

const STUBS = {
  ObsidianModal: { template: '<div><slot /></div>' },
  Dropdown: {
    name: 'Dropdown',
    props: ['modelValue', 'options'],
    emits: ['update:model-value'],
    template: '<div class="dropdown-stub" />',
  },
}

const open = <T>(component: T, props: Record<string, unknown> = {}) =>
  mount(component as never, { props, global: { stubs: STUBS } })
type Screen = ReturnType<typeof open>

/** The connection of a device syncing "Home" on sync.example.com. */
const home = (): DeviceConnection => {
  const connection: DeviceConnection = {
    ...emptyConnection(),
    serverUrl: 'https://sync.example.com',
    enrolledUrl: 'https://sync.example.com',
    vaultId: 'v1',
    vaultName: 'Home',
    deviceId: 'd1',
    deviceTokenId: 'abele-sync-device-1',
    deviceName: 'Laptop',
    migrated: true,
  }
  connection.selective.video = false
  connection.selective.maxFileBytes = 1024
  return connection
}

const SIBLING = {
  serverUrl: 'https://sync.example.com',
  vaultId: 'v1',
  vaultName: 'Home',
  deviceId: 'd2',
  deviceName: 'Other device',
  token: 'absd_sibling',
}

const service = {
  status: ref({ ...DISCONNECTED_STATUS }),
  connection: ref<DeviceConnection>(emptyConnection()),
  enrolSibling: vi.fn(),
  adoptTransferred: vi.fn(() => Promise.resolve()),
  revokeTransferred: vi.fn(() => Promise.resolve()),
  updateConnection: vi.fn(() => Promise.resolve()),
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().applySettings({
    refreshDelay: 500,
    ai: { ...DEFAULT_AI_SETTINGS, providers: [] } as AiSettings,
  })
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  service.connection.value = emptyConnection()
  service.enrolSibling.mockResolvedValue(SIBLING)
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const cardNamed = (screen: Screen, name: string) =>
  screen.findAll('.abele-card').find((card) => card.text().includes(name))

const buttonNamed = (screen: Screen, text: string) =>
  screen.findAllComponents(Button).find((b) => b.props('text') === text)

const click = async (screen: Screen, text: string) => {
  await buttonNamed(screen, text)?.trigger('click')
  await flushPromises()
}

const waitFor = async (ready: () => boolean, timeout = 4000) => {
  const started = Date.now()
  while (!ready()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await flushPromises()
}

/** What the send modal is showing, read back the way the other device would. */
async function sent(screen: Screen): Promise<TransferPayload> {
  const modal = screen.findComponent(TransferSendModal)
  const receiver = createReceiver()
  for (const frame of modal.props('frames') as string[]) receiver.accept(frame)
  const result = await decodePayload(receiver.assemble(), modal.props('code') as string | undefined)
  if (!result.ok) throw new Error(result.reason)
  return result.payload
}

const connectionIn = (payload: TransferPayload) =>
  payload.entries.find((entry) => entry.section === 'connection')

describe('sending the connection', () => {
  it('is not offered by a device that syncs nothing', () => {
    const screen = open(TransferSettings)

    expect(cardNamed(screen, 'Sync connection')).toBeUndefined()
  })

  it('asks what the other device is called before a device is made for it', async () => {
    service.connection.value = home()
    const screen = open(TransferSettings)
    await cardNamed(screen, 'Sync connection')!.trigger('click')
    await flushPromises()

    await click(screen, 'Send')

    const modal = screen.findComponent(TransferSendModal)
    expect(modal.props('naming')).toBe(true)
    expect(modal.findComponent(Input).props('modelValue')).toBe('Other device')
    expect(service.enrolSibling).not.toHaveBeenCalled()
  })

  it('makes one device, under the name given, and sends its token locked behind a code', async () => {
    service.connection.value = home()
    service.enrolSibling.mockResolvedValue({ ...SIBLING, deviceName: 'Phone' })
    const screen = open(TransferSettings)
    await cardNamed(screen, 'Sync connection')!.trigger('click')
    await click(screen, 'Send')

    await screen
      .findComponent(TransferSendModal)
      .findComponent(Input)
      .vm.$emit('update:model-value', 'Phone')
    await click(screen, 'Make the codes')
    await waitFor(() => (screen.findComponent(TransferSendModal).props('frames') ?? []).length > 0)

    expect(service.enrolSibling).toHaveBeenCalledTimes(1)
    expect(service.enrolSibling).toHaveBeenCalledWith('Phone')
    expect(screen.findComponent(TransferSendModal).props('code')).toMatch(/^[A-Z2-9]{8}$/)
    const payload = await sent(screen)
    expect(connectionIn(payload)?.data).toMatchObject({
      deviceId: 'd2',
      deviceName: 'Phone',
      vaultId: 'v1',
    })
    expect(payload.secrets[CONNECTION_TOKEN]).toBe('absd_sibling')
    expect(JSON.stringify(payload)).not.toContain('abele-sync-device-1')
    expect(JSON.stringify(payload)).not.toContain('maxFileBytes')
  })

  it('sends only what the device syncs when the server cannot be reached, and says so', async () => {
    service.connection.value = home()
    service.enrolSibling.mockRejectedValue(new EngineError('offline', 'never reached the server'))
    const screen = open(TransferSettings)
    await cardNamed(screen, 'Sync connection')!.trigger('click')
    await click(screen, 'Send')

    await click(screen, 'Make the codes')
    await waitFor(() => (screen.findComponent(TransferSendModal).props('frames') ?? []).length > 0)

    expect(screen.findComponent(TransferSendModal).text()).toContain(
      'No device was made for the other side (never reached the server), so it will sign in itself.'
    )
    const payload = await sent(screen)
    expect(Object.keys(connectionIn(payload)!.data as object)).toEqual(['selective'])
    expect(payload.secrets).toEqual({})
  })

  /** Not every refusal is the network: the server's limit, or a token this device lost. */
  it('does not blame the network for a refusal that is not the network', async () => {
    service.connection.value = home()
    service.enrolSibling.mockRejectedValue(new Error('too many devices made in a minute'))
    const screen = open(TransferSettings)
    await cardNamed(screen, 'Sync connection')!.trigger('click')
    await click(screen, 'Send')

    await click(screen, 'Make the codes')
    await waitFor(() => (screen.findComponent(TransferSendModal).props('frames') ?? []).length > 0)

    const text = screen.findComponent(TransferSendModal).text()
    expect(text).toContain(
      'No device was made for the other side (too many devices made in a minute)'
    )
    expect(text).not.toContain('could not reach')
  })

  it('makes no device, and asks for no name, when keys are left behind', async () => {
    service.connection.value = home()
    const screen = open(TransferSettings)
    await screen.findComponent(Checkbox).vm.$emit('toggle')
    await cardNamed(screen, 'Sync connection')!.trigger('click')
    await flushPromises()

    await click(screen, 'Send')
    await waitFor(() => (screen.findComponent(TransferSendModal).props('frames') ?? []).length > 0)

    expect(service.enrolSibling).not.toHaveBeenCalled()
    const payload = await sent(screen)
    expect(Object.keys(connectionIn(payload)!.data as object)).toEqual(['selective'])
  })
})

describe('receiving the connection', () => {
  /** A transfer made the way the sending screen makes it, with a provider beside the connection. */
  async function transferText(sibling = SIBLING): Promise<string> {
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      providers: [{ id: 'p1', name: 'openwebui', baseUrl: 'https://o.example', models: [] }],
    } as unknown as AiSettings
    const provider = collectEntries(AbeleConfig.getInstance().exportSettings()).find(
      (entry) => entry.section === 'ai-providers'
    )!
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, providers: [] } as AiSettings
    const { entry, secrets } = withSibling(connectionEntry(home())!, sibling)
    const payload = buildPayload([provider, entry], null)
    Object.assign(payload.secrets, secrets)
    return toText(await encodePayload(payload), newTransferId())
  }

  async function received(): Promise<Screen> {
    const text = await transferText()
    const screen = open(TransferScanModal)
    await click(screen, 'Paste the text')
    await screen.findComponent(Input).vm.$emit('update:model-value', text)
    await waitFor(() => screen.text().includes('to apply'))
    return screen
  }

  const rowOf = (screen: Screen) =>
    screen
      .findAll('.abele-transfer-scan__entry')
      .find((row) => row.text().includes('Sync connection'))!

  const ticked = (screen: Screen) => rowOf(screen).findComponent(Checkbox).props('isEnabled')

  it('is taken by a device that syncs nothing, with its token filed by the service alone', async () => {
    const screen = await received()

    expect(ticked(screen)).toBe(true)
    await click(screen, 'Apply')

    expect(service.adoptTransferred).toHaveBeenCalledTimes(1)
    const [connection, token, selective] = service.adoptTransferred.mock.calls[0] as unknown as [
      object,
      string,
      object,
    ]
    expect(connection).toMatchObject({ deviceId: 'd2', vaultId: 'v1' })
    expect(token).toBe('absd_sibling')
    expect(selective).toMatchObject({ video: false })
    expect(selective).not.toHaveProperty('maxFileBytes')
    expect(service.revokeTransferred).not.toHaveBeenCalled()
  })

  it('is skipped by a device that already syncs that vault, and the spare device revoked', async () => {
    service.connection.value = { ...home(), deviceId: 'd9' }
    const screen = await received()

    expect(rowOf(screen).text()).toContain('Already connected to this vault')
    expect(ticked(screen)).toBe(false)
    await rowOf(screen).trigger('click')
    expect(ticked(screen)).toBe(false)
    await click(screen, 'Apply')

    expect(service.adoptTransferred).not.toHaveBeenCalled()
    expect(service.revokeTransferred).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'd2' }),
      'absd_sibling'
    )
    expect(AbeleConfig.getInstance().ai.providers.map((p) => p.name)).toEqual(['openwebui'])
  })

  /**
   * Apply takes seconds on a phone — the adopt reconciles and builds an engine. A second press
   * meanwhile must not run it again: by then the connection may be saved, the transfer reads as
   * "the same vault", and the device just adopted would be revoked under this one.
   */
  it('takes the connection once, however often Apply is pressed', async () => {
    let adopted: () => void = () => undefined
    service.adoptTransferred.mockImplementation(
      () => new Promise<void>((resolve) => (adopted = resolve))
    )
    const screen = await received()

    await buttonNamed(screen, 'Apply')!.trigger('click')
    await buttonNamed(screen, 'Apply')!.trigger('click')
    await flushPromises()
    expect(buttonNamed(screen, 'Apply')!.props('disabled')).toBe(true)
    // What the first press has saved by now: this device syncs the vault that arrived.
    service.connection.value = { ...home(), deviceId: 'd2' }
    adopted()
    await flushPromises()
    await buttonNamed(screen, 'Apply')!.trigger('click')
    await flushPromises()
    expect(screen.emitted('applied')).toHaveLength(1)
    screen.unmount()

    expect(service.adoptTransferred).toHaveBeenCalledTimes(1)
    expect(service.revokeTransferred).not.toHaveBeenCalled()
  })

  it('stores no key for the connection, and does not count its token as one', async () => {
    const screen = await received()

    expect(screen.text()).toContain('No keys came with this transfer.')
  })

  describe('closed without Apply', () => {
    it('revokes the spare device when this device already syncs that vault', async () => {
      service.connection.value = { ...home(), deviceId: 'd9' }
      const screen = await received()

      screen.unmount()
      await flushPromises()

      expect(service.revokeTransferred).toHaveBeenCalledTimes(1)
      expect(service.revokeTransferred).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'd2' }),
        'absd_sibling'
      )
    })

    it('revokes it only once when it was applied first', async () => {
      service.connection.value = { ...home(), deviceId: 'd9' }
      const screen = await received()
      await click(screen, 'Apply')

      screen.unmount()
      await flushPromises()

      expect(service.revokeTransferred).toHaveBeenCalledTimes(1)
    })

    it('revokes it when the switch to it was left unticked', async () => {
      service.connection.value = { ...home(), vaultId: 'v7', vaultName: 'Work' }
      const screen = await received()

      screen.unmount()
      await flushPromises()

      expect(service.revokeTransferred).toHaveBeenCalledTimes(1)
    })

    it('keeps it when the switch was ticked, or on a device that syncs nothing', async () => {
      service.connection.value = { ...home(), vaultId: 'v7', vaultName: 'Work' }
      const ticking = await received()
      await rowOf(ticking).trigger('click')
      ticking.unmount()
      service.connection.value = emptyConnection()
      const fresh = await received()
      fresh.unmount()
      await flushPromises()

      expect(service.revokeTransferred).not.toHaveBeenCalled()
    })
  })

  describe('on a device that syncs another vault', () => {
    beforeEach(() => {
      service.connection.value = { ...home(), vaultId: 'v7', vaultName: 'Work' }
    })

    it('is offered unticked, saying it replaces this device’s own', async () => {
      const screen = await received()

      expect(ticked(screen)).toBe(false)
      expect(rowOf(screen).text()).toContain("Replaces this device's own connection")
    })

    it('asks before switching, naming both vaults', async () => {
      const screen = await received()
      await rowOf(screen).trigger('click')

      await click(screen, 'Apply')

      const confirm = screen.findComponent(ConfirmModal)
      expect(confirm.exists()).toBe(true)
      expect(confirm.props('message')).toBe(
        'This device syncs Work on https://sync.example.com. Switch it to Home? It will be ' +
          'disconnected from Work, and the server there will be told.'
      )
      expect(service.adoptTransferred).not.toHaveBeenCalled()
      expect(AbeleConfig.getInstance().ai.providers).toHaveLength(0)
    })

    it('switches once confirmed', async () => {
      const screen = await received()
      await rowOf(screen).trigger('click')
      await click(screen, 'Apply')

      screen.findComponent(ConfirmModal).vm.$emit('confirm')
      screen.findComponent(ConfirmModal).vm.$emit('close')
      await flushPromises()

      expect(service.adoptTransferred).toHaveBeenCalledTimes(1)
      expect(service.revokeTransferred).not.toHaveBeenCalled()
      expect(AbeleConfig.getInstance().ai.providers.map((p) => p.name)).toEqual(['openwebui'])
    })

    it('applies the rest and revokes the spare device when the switch is declined', async () => {
      const screen = await received()
      await rowOf(screen).trigger('click')
      await click(screen, 'Apply')

      screen.findComponent(ConfirmModal).vm.$emit('close')
      await flushPromises()

      expect(service.adoptTransferred).not.toHaveBeenCalled()
      expect(service.revokeTransferred).toHaveBeenCalledTimes(1)
      expect(AbeleConfig.getInstance().ai.providers.map((p) => p.name)).toEqual(['openwebui'])
      expect(screen.emitted('applied')?.[0]?.[0]).toMatchObject({ items: 1 })
    })

    it('says this device was disconnected from its vault when the switch then failed', async () => {
      service.adoptTransferred.mockImplementation(() => {
        service.connection.value = emptyConnection()
        return Promise.reject(new Error('the keychain refused'))
      })
      const screen = await received()
      await rowOf(screen).trigger('click')
      await click(screen, 'Apply')

      screen.findComponent(ConfirmModal).vm.$emit('confirm')
      screen.findComponent(ConfirmModal).vm.$emit('close')
      await flushPromises()

      const line = (screen.emitted('applied')?.[0]?.[0] as { connection?: string }).connection
      expect(line).toContain('disconnected from Work')
      expect(line).toContain('the keychain refused')
    })

    it('revokes the spare device when the connection is left unticked', async () => {
      const screen = await received()

      await click(screen, 'Apply')

      expect(screen.findComponent(ConfirmModal).exists()).toBe(false)
      expect(service.adoptTransferred).not.toHaveBeenCalled()
      expect(service.revokeTransferred).toHaveBeenCalledTimes(1)
    })
  })
})
