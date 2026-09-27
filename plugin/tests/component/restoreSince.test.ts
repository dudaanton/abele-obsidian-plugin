/**
 * "Restore all deleted since…" in the Deleted files dialog (phase 3b, decision 8).
 *
 * The files are picked by the time the server recorded each delete, from a preset or a time the
 * person gives; how many is said before anything happens, the question names the count, the
 * first files and the devices that deleted them, and what is said afterwards counts what came
 * back, what came back under a new name, and what did not.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { Notice } from 'obsidian'
import type { CommitOpResult, TrashItem } from '@abele/sync-protocol'
import RestoreSince from '@/components/sync/RestoreSince.vue'
import Button from '@/components/obsidian/Button.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Input from '@/components/obsidian/Input.vue'
import Setting from '@/components/obsidian/Setting.vue'
import { SyncService } from '@/sync/SyncService'
import { DISCONNECTED_STATUS, type SyncStatus } from '@/sync/status'
import { useVault } from '../helpers/testEnv'

const STUBS = { ObsidianModal: { template: '<div><slot /></div>' }, Dropdown: true }

/** 15:00 on this device's clock; the items are placed around it. */
const NOW = new Date(2026, 8, 27, 15, 0)
const at = (hours: number, minutes = 0): string =>
  new Date(2026, 8, 27, hours, minutes).toISOString()

const laptop = { kind: 'device' as const, id: 'd1', name: 'MacBook' }
const phone = { kind: 'device' as const, id: 'd2', name: 'Phone' }

const item = (
  id: string,
  path: string,
  deletedAt: string,
  by: TrashItem['deleted_by'] = laptop
): TrashItem => ({
  file_id: id,
  path,
  kind: 'note',
  deleted_at: deletedAt,
  last_version_id: `v-${id}`,
  size: 10,
  deleted_by: by,
})

const ITEMS: TrashItem[] = [
  item('f1', 'Notes/one.md', at(14, 30)),
  item('f2', 'Notes/two.md', at(14, 10), phone),
  item('f3', 'Notes/three.md', at(9)),
  item('f4', 'Notes/yesterday.md', new Date(2026, 8, 26, 23, 0).toISOString()),
]

const applied = (id: string, path: string): CommitOpResult => ({
  status: 'applied',
  file_id: id,
  version_id: `v-new-${id}`,
  seq: 1,
  path,
  sha: 'sha',
  size: 10,
  mtime: 0,
})

const client = { restoreDeletedMany: vi.fn() }

const service = {
  status: ref<SyncStatus>({ ...DISCONNECTED_STATUS, state: 'idle' }),
  client: vi.fn(() => client),
  syncNow: vi.fn(),
  note: vi.fn(),
}

const open = (items: TrashItem[] = ITEMS) =>
  mount(RestoreSince, { props: { items }, global: { stubs: STUBS } })
type View = ReturnType<typeof open>

const button = (view: View, prefix: string) =>
  view.findAllComponents(Button).find((b) => (b.props('text') as string).startsWith(prefix))

const preview = (view: View): string => view.findComponent(Setting).props('desc') as string

async function choose(view: View, preset: string): Promise<void> {
  view.findComponent(Dropdown).vm.$emit('update:model-value', preset)
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  useVault([])
  Notice.shown.length = 0
  service.status.value = { ...DISCONNECTED_STATUS, state: 'idle' }
  client.restoreDeletedMany.mockImplementation(async (ids: string[]) =>
    ids.map((id) => applied(id, ITEMS.find((one) => one.file_id === id)!.path))
  )
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('picking what to restore', () => {
  it('starts with the last hour, by the time the server recorded each delete', () => {
    const view = open()

    expect(preview(view)).toContain('2 files deleted since then')
    expect(button(view, 'Restore')!.props('text')).toBe('Restore 2…')
  })

  it('takes everything deleted today', async () => {
    const view = open()
    await choose(view, 'today')

    expect(preview(view)).toContain('3 files deleted since then')
  })

  it('takes a time the person gives', async () => {
    const view = open()
    await choose(view, 'custom')
    view.findComponent(Input).vm.$emit('update:model-value', '2026-09-26T22:00')
    await flushPromises()

    expect(preview(view)).toContain('4 files deleted since then')
  })

  it('offers nothing to restore when nothing went since then', async () => {
    const view = open([ITEMS[3]!])

    expect(preview(view)).toContain('Nothing was deleted since then')
    expect(button(view, 'Restore')!.props('disabled')).toBe(true)
  })
})

describe('restoring them', () => {
  it('asks first, naming the count, the first files and who deleted them', async () => {
    const view = open()

    await button(view, 'Restore')!.trigger('click')

    expect(client.restoreDeletedMany).not.toHaveBeenCalled()
    const confirm = view.findComponent(ConfirmModal)
    expect(confirm.props('title')).toBe('Restore 2 files?')
    expect(confirm.props('message')).toContain('Notes/one.md')
    expect(confirm.props('message')).toContain('1 by MacBook, 1 by Phone')
  })

  it('restores exactly those, syncs, and counts what came back and how', async () => {
    client.restoreDeletedMany.mockResolvedValue([
      applied('f1', 'Notes/one.md'),
      applied('f2', 'Notes/two 1.md'),
    ])
    const view = open()
    await button(view, 'Restore')!.trigger('click')

    view.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(client.restoreDeletedMany.mock.calls[0]![0]).toEqual(['f1', 'f2'])
    expect(service.syncNow).toHaveBeenCalled()
    expect(Notice.shown).toContain(
      'Restored 2; 1 came back under a new name because the old one was taken; 0 failed.'
    )
    expect(view.emitted('restored')).toEqual([[['f1', 'f2']]])
  })

  it('counts a file no longer in the trash as not restored, and takes it off the list', async () => {
    client.restoreDeletedMany.mockResolvedValue([
      applied('f1', 'Notes/one.md'),
      { status: 'rejected', code: 'not_found', message: 'not in the trash' },
    ])
    const view = open()
    await button(view, 'Restore')!.trigger('click')

    view.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(Notice.shown).toContain(
      'Restored 1; 0 came back under a new name because the old one was taken; 1 failed.'
    )
    expect(view.emitted('restored')).toEqual([[['f1', 'f2']]])
  })

  it('says the files arrive when sync resumes, while it is paused', async () => {
    service.status.value = { ...service.status.value, state: 'paused' }
    const view = open()
    await button(view, 'Restore')!.trigger('click')

    view.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(Notice.shown.some((text) => text.includes('when sync is resumed'))).toBe(true)
  })

  it('says what went wrong, and restores nothing more, when the server fails', async () => {
    client.restoreDeletedMany.mockRejectedValue(new Error('the server went away'))
    const view = open()
    await button(view, 'Restore')!.trigger('click')

    view.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(view.text()).toContain('the server went away')
    expect(view.emitted('restored')).toBeFalsy()
  })
})
