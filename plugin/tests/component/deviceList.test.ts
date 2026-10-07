/**
 * The devices on this vault, on the Sync tab (phase 3b, controller ruling after the task-4
 * review, #2b): name, platform, who enrolled it and when it was last seen; this device marked and
 * never offered Revoke; every other device revoked only after a confirmation that says it stops
 * syncing and keeps its files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { Notice } from 'obsidian'
import { AbeleError, type DeviceInfo } from '@abele/sync-protocol'
import DeviceList from '@/components/settings/sync/DeviceList.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Button from '@/components/obsidian/Button.vue'
import Badge from '@/components/obsidian/Badge.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { SyncService } from '@/sync/SyncService'
import { useVault } from '../helpers/testEnv'

const STUBS = { ObsidianModal: { template: '<div><slot /></div>' } }

const device = (over: Partial<DeviceInfo>): DeviceInfo => ({
  id: 'd-x',
  name: 'X',
  platform: 'desktop',
  vault_id: 'v1',
  created_at: '2026-09-01T10:00:00.000Z',
  last_seen_at: null,
  enrolled_by: null,
  ...over,
})

const DEVICES = [
  device({ id: 'd-mac', name: 'Mac', last_seen_at: new Date().toISOString() }),
  device({ id: 'd-phone', name: 'Phone', platform: 'mobile', enrolled_by: 'd-mac' }),
  device({ id: 'd-sidings', name: 'sidings', platform: 'daemon', enrolled_by: 'd-gone' }),
]

const service = {
  connection: ref({ deviceId: 'd-mac' }),
  status: ref({ state: 'idle' as string }),
  listDevices: vi.fn(),
  revokeDevice: vi.fn(),
}

const open = () => mount(DeviceList, { global: { stubs: STUBS } })
type View = ReturnType<typeof open>

const row = (view: View, name: string) =>
  view.findAllComponents(Setting).find((s) => s.props('name') === name)!

const revokeOf = (view: View, name: string) =>
  row(view, name)
    .findAllComponents(Button)
    .find((b) => b.props('text') === 'Revoke')

beforeEach(() => {
  useVault([])
  Notice.shown.length = 0
  service.listDevices.mockResolvedValue(DEVICES)
  service.status.value = { state: 'idle' }
  service.revokeDevice.mockResolvedValue(undefined)
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('the devices on this vault', () => {
  it('lists each with its platform, who enrolled it and when it was last seen', async () => {
    const view = open()
    await flushPromises()

    expect(row(view, 'Mac').props('desc')).toMatch(
      /^Desktop · connected with the account password · last seen/
    )
    expect(row(view, 'Phone').props('desc')).toBe(
      'Phone or tablet · connected by Mac · never seen syncing'
    )
    expect(row(view, 'sidings').props('desc')).toBe(
      'Command-line client · connected by a device no longer on this vault · never seen syncing'
    )
  })

  it('marks this device and offers it no Revoke', async () => {
    const view = open()
    await flushPromises()

    const own = row(view, 'Mac')
    expect(own.findAllComponents(Badge).map((b) => b.props('text'))).toContain('This device')
    expect(revokeOf(view, 'Mac')).toBeUndefined()
    expect(revokeOf(view, 'Phone')).toBeDefined()
  })

  it('asks before revoking, then revokes and reads the list again', async () => {
    const view = open()
    await flushPromises()

    await revokeOf(view, 'Phone')!.trigger('click')
    expect(service.revokeDevice).not.toHaveBeenCalled()
    const confirm = view.findComponent(ConfirmModal)
    expect(confirm.props('title')).toBe('Revoke Phone?')
    expect(confirm.props('message')).toMatch(/stops syncing/)
    expect(confirm.props('message')).toMatch(/its files stay/)

    service.listDevices.mockResolvedValue(DEVICES.filter((d) => d.id !== 'd-phone'))
    confirm.vm.$emit('confirm')
    await flushPromises()

    expect(service.revokeDevice).toHaveBeenCalledWith('d-phone')
    expect(service.listDevices).toHaveBeenCalledTimes(2)
    expect(view.findAllComponents(Setting).map((s) => s.props('name'))).not.toContain('Phone')
    expect(Notice.shown.some((text) => text.includes('Phone was revoked'))).toBe(true)
  })

  it('reads the list again when the device was already gone', async () => {
    service.revokeDevice.mockRejectedValue(new AbeleError('not_found', 'no such device'))
    const view = open()
    await flushPromises()

    await revokeOf(view, 'Phone')!.trigger('click')
    view.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(service.listDevices).toHaveBeenCalledTimes(2)
    expect(Notice.shown.some((text) => text.includes('already gone'))).toBe(true)
  })

  it('says to wait a minute when the server is asked too often', async () => {
    service.revokeDevice.mockRejectedValue(new AbeleError('rate_limited', 'slow down'))
    const view = open()
    await flushPromises()

    await revokeOf(view, 'Phone')!.trigger('click')
    view.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(view.text()).toContain('try again in a minute')
  })

  it('says why when the list cannot be read', async () => {
    service.listDevices.mockRejectedValue(new Error('the server is down'))
    const view = open()
    await flushPromises()

    expect(view.findComponent(EmptyState).props('text')).toContain('the server is down')
  })

  it('says so on a device with no server to ask', async () => {
    service.listDevices.mockResolvedValue(null)
    const view = open()
    await flushPromises()

    expect(view.findComponent(EmptyState).props('text')).toMatch(/not connected/)
  })

  /**
   * Review of task 12, #7: opened while the engine was still being built — a start, a join just
   * answered — the section said "not connected" for as long as the tab stayed open.
   */
  it('reads the list again once the engine that was being built is running', async () => {
    service.status.value = { state: 'disconnected' }
    service.listDevices.mockResolvedValueOnce(null)
    const view = open()
    await flushPromises()
    expect(view.findComponent(EmptyState).props('text')).toMatch(/not connected/)

    service.status.value = { state: 'syncing' }
    await flushPromises()

    // Views of earlier tests stay mounted and watch the same status, so the list is what counts.
    expect(view.findComponent(EmptyState).exists()).toBe(false)
    expect(row(view, 'Phone')).toBeDefined()
  })

  it('does not ask again as syncs come and go', async () => {
    open()
    await flushPromises()
    service.status.value = { state: 'syncing' }
    await flushPromises()
    service.status.value = { state: 'idle' }
    await flushPromises()

    expect(service.listDevices).toHaveBeenCalledTimes(1)
  })
})
