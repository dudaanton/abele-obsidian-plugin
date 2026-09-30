/**
 * The question about Obsidian settings changed on another device (phase 3b, decision 11).
 *
 * What is asserted here: the dialog names what changed — Obsidian's own settings by name, the
 * plugins by the name in their manifest or else their folder, and the device it came from — and
 * warns that changing settings here first keeps this device's; Reload now applies and reloads,
 * or says to restart where Obsidian has no reload; Keep this device's keeps the files shown and
 * says what was left on the other device; Later decides nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { Notice } from 'obsidian'
import type { ChangeItem } from '@abele/sync-protocol'
import SettingsArrivedModal from '@/components/sync/SettingsArrivedModal.vue'
import StagedSettingsBlock from '@/components/sync/StagedSettingsBlock.vue'
import Button from '@/components/obsidian/Button.vue'
import { SyncService } from '@/sync/SyncService'
import { useVault } from '../helpers/testEnv'

/** The dialog itself is Obsidian's; unwrapping it puts the body where a query can reach it. */
const STUBS = { ObsidianModal: { template: '<div><slot /></div>' } }

let seq = 0
const change = (path: string, from = 'Laptop'): ChangeItem => ({
  seq: ++seq,
  file_id: `f${seq}`,
  op: 'modify',
  path,
  prev_path: null,
  sha: 'a'.repeat(64),
  size: 2,
  mtime: 1,
  version_id: `v${seq}`,
  kind: 'config',
  actor: { kind: 'device', id: `d-${from}`, name: from },
  at: '2026-09-27T10:00:00.000Z',
})

const CHANGES = [
  change('.obsidian/app.json'),
  change('.obsidian/hotkeys.json'),
  change('.obsidian/plugins/dataview/data.json'),
  change('.obsidian/plugins/obsidian-tasks-plugin/data.json'),
]
const NAMES = { dataview: 'Dataview' }

const service = {
  settingsPrompt: {
    reloader: { available: vi.fn(() => true), reload: vi.fn(() => true) },
    appliedWaiting: ref<string[]>([]),
  },
  reloadAppliedSettings: vi.fn(async () => true),
  applySettingsAndReload: vi.fn(),
  keepLocalSettings: vi.fn(),
  note: vi.fn(),
}

const open = (changes = CHANGES) =>
  mount(SettingsArrivedModal, {
    props: { changes, names: NAMES },
    global: { stubs: STUBS },
  })
type View = ReturnType<typeof open>

const button = (view: View, text: string) =>
  view.findAllComponents(Button).find((b) => b.props('text') === text)

beforeEach(() => {
  useVault([])
  Notice.shown.length = 0
  service.settingsPrompt.appliedWaiting.value = []
  service.settingsPrompt.reloader.available.mockReturnValue(true)
  service.applySettingsAndReload.mockResolvedValue({
    applied: CHANGES.map((c) => c.path),
    skipped: [],
    reloaded: true,
    unshown: [],
  })
  service.keepLocalSettings.mockResolvedValue({
    kept: CHANGES.map((c) => c.path),
    left: [],
    blocked: [],
    unshown: [],
  })
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('the settings-arrived dialog', () => {
  it('names what changed, in groups, and where it came from', () => {
    const view = open()

    expect(view.text()).toContain(
      'Obsidian settings changed on another device: App settings, Hotkeys, 2 plugins (Dataview, obsidian-tasks-plugin). Reload Obsidian to apply them.'
    )
    expect(view.text()).toContain('From Laptop.')
    expect(view.text()).toContain(
      "Changing settings here before reloading keeps this device's version everywhere."
    )
  })

  it('names every device the changes came from', () => {
    const view = open([change('.obsidian/app.json'), change('.obsidian/hotkeys.json', 'Phone')])
    expect(view.text()).toContain('From Laptop and Phone.')
  })

  it('applies and reloads with Reload now', async () => {
    const view = open()

    await button(view, 'Reload now')!.trigger('click')
    await flushPromises()

    expect(service.applySettingsAndReload).toHaveBeenCalledTimes(1)
    expect(service.applySettingsAndReload).toHaveBeenCalledWith(CHANGES.map((c) => c.version_id))
    expect(Notice.shown).toContain('Settings applied; Obsidian is reloading.')
    expect(view.emitted('close')).toBeTruthy()
  })

  it('names partial writes and offers an explicit reload without claiming nothing changed', async () => {
    service.settingsPrompt.appliedWaiting.value = ['.obsidian/app.json']
    service.applySettingsAndReload.mockResolvedValue({
      applied: ['.obsidian/app.json'],
      skipped: [],
      reloaded: false,
      unshown: [],
      failed: [{ path: '.obsidian/hotkeys.json', reason: 'write unavailable' }],
    })
    const view = open()
    await button(view, 'Reload now')!.trigger('click')
    await flushPromises()
    expect(Notice.shown.join(' ')).toContain('Applied 1: .obsidian/app.json')
    expect(Notice.shown.join(' ')).toContain('Failed 1: .obsidian/hotkeys.json')
    expect(view.text()).not.toContain('Nothing was changed')
    await button(view, 'Reload applied settings')!.trigger('click')
    await flushPromises()
    expect(service.reloadAppliedSettings).toHaveBeenCalledTimes(1)
  })

  it('asks for a restart instead where Obsidian cannot reload itself', async () => {
    service.settingsPrompt.reloader.available.mockReturnValue(false)
    service.applySettingsAndReload.mockResolvedValue({
      applied: ['.obsidian/app.json'],
      skipped: [],
      reloaded: false,
      unshown: [],
    })
    const view = open()

    expect(view.text()).toContain('Apply them, then restart Obsidian to use them.')
    expect(button(view, 'Reload now')).toBeUndefined()
    await button(view, 'Apply')!.trigger('click')
    await flushPromises()

    expect(Notice.shown).toContain(
      'Settings applied. Restart Obsidian to use them, and change no setting before you do: its save would put the old values back everywhere.'
    )
  })

  it("keeps this device's files for exactly the changes shown, and says what was left there", async () => {
    service.keepLocalSettings.mockResolvedValue({
      kept: ['.obsidian/app.json'],
      left: ['.obsidian/plugins/obsidian-tasks-plugin/data.json'],
      blocked: [],
      unshown: [],
    })
    const view = open()

    expect(view.text()).toContain("Keep this device's sends this device's files")
    await button(view, "Keep this device's")!.trigger('click')
    await flushPromises()

    expect(service.keepLocalSettings).toHaveBeenCalledWith(
      CHANGES.map((c) => c.path),
      CHANGES.map((c) => c.version_id)
    )
    expect(
      Notice.shown.some((text) =>
        text.includes('1 file exists only on the other device and was left there.')
      )
    ).toBe(true)
    expect(view.emitted('close')).toBeTruthy()
  })

  it('decides nothing with Later', async () => {
    const view = open()

    await button(view, 'Later')!.trigger('click')

    expect(service.applySettingsAndReload).not.toHaveBeenCalled()
    expect(service.keepLocalSettings).not.toHaveBeenCalled()
    expect(view.emitted('close')).toBeTruthy()
  })

  it('keeps the question open with the reason when applying fails', async () => {
    service.applySettingsAndReload.mockRejectedValue(new Error('the ledger closed'))
    const view = open()

    await button(view, 'Reload now')!.trigger('click')
    await flushPromises()

    expect(view.text()).toContain('the ledger closed')
    expect(view.emitted('close')).toBeFalsy()
  })
})

describe('the settings block on the Sync tab', () => {
  it('offers Apply and reload and Keep, and no Later', () => {
    const view = mount(StagedSettingsBlock, {
      props: { changes: CHANGES, names: NAMES, applyText: 'Apply and reload' },
      global: { stubs: STUBS },
    })

    const texts = view.findAllComponents(Button).map((b) => b.props('text'))
    expect(texts).toContain('Apply and reload')
    expect(texts).toContain("Keep this device's")
    expect(texts).not.toContain('Later')
  })
})
