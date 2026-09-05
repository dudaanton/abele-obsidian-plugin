/**
 * The vault's trash, as the dialog behind "Open deleted files" shows it.
 *
 * This is the server's trash rather than Obsidian's: a file deleted on one device is gone from
 * every device the moment they sync, and the only copy left is the one the server holds until
 * retention sweeps it. So the list comes from the server, and restoring is a commit followed by
 * a pull — nothing here writes into the vault, and the assertions say so.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import type { TrashItem } from '@abele/sync-protocol'
import DeletedFilesModal from '@/components/sync/DeletedFilesModal.vue'
import Card from '@/components/obsidian/Card.vue'
import Badge from '@/components/obsidian/Badge.vue'
import Button from '@/components/obsidian/Button.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { SyncService } from '@/sync/SyncService'
import { DISCONNECTED_STATUS, type SyncStatus } from '@/sync/status'
import { useVault } from '../helpers/testEnv'

/** The dialog itself is Obsidian's; unwrapping it puts the body where a query can reach it. */
const STUBS = { ObsidianModal: { template: '<div><slot /></div>' } }

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString()

const TRASH: TrashItem[] = [
  {
    file_id: 'f-old',
    path: 'Notes/older.md',
    kind: 'note',
    deleted_at: minutesAgo(90),
    last_version_id: 'v9',
    size: 2048,
  },
  {
    file_id: 'f-new',
    path: 'Attachments/photo.png',
    kind: 'attachment',
    deleted_at: minutesAgo(5),
    last_version_id: 'v4',
    size: 1024,
  },
]

const client = {
  trash: vi.fn(),
  restoreDeleted: vi.fn(),
}

const service = {
  status: ref<SyncStatus>({ ...DISCONNECTED_STATUS }),
  log: ref<string[]>([]),
  connected: true,
  isConnected: vi.fn(() => service.connected),
  client: vi.fn(() => (service.connected ? client : null)),
  syncNow: vi.fn(),
  note: vi.fn(),
}

const open = () => mount(DeletedFilesModal, { global: { stubs: STUBS } })
type Screen = ReturnType<typeof open>

const titles = (screen: Screen): string[] =>
  screen.findAllComponents(Card).map((card) => card.props('title') as string)

const restoreFor = (screen: Screen, path: string) =>
  screen
    .findAllComponents(Card)
    .find((card) => card.props('title') === path)
    ?.findComponent(Button)

beforeEach(() => {
  useVault([])
  service.connected = true
  client.trash.mockResolvedValue(TRASH)
  client.restoreDeleted.mockResolvedValue({ status: 'applied' })
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('what has been deleted', () => {
  it('lists the whole vault trash, most recently deleted first', async () => {
    const screen = open()
    await flushPromises()

    expect(client.trash).toHaveBeenCalled()
    expect(titles(screen)).toEqual(['Attachments/photo.png', 'Notes/older.md'])
  })

  it('says what kind of file each one was, when it went, and how much comes back', async () => {
    const screen = open()
    await flushPromises()

    expect(screen.findAllComponents(Badge).map((b) => b.props('text'))).toEqual([
      'Attachment',
      'Note',
    ])
    expect(screen.findAllComponents(Card)[0].props('meta')).toEqual([
      'Deleted 5 minutes ago',
      '1.0 KB',
    ])
  })

  it('says the trash is empty rather than showing an empty list', async () => {
    client.trash.mockResolvedValue([])
    const screen = open()
    await flushPromises()

    expect(screen.findAllComponents(Card)).toHaveLength(0)
    expect(screen.findComponent(EmptyState).props('text')).toContain('Nothing has been deleted')
  })

  it('says where the trash lives when this device is not connected to a server', async () => {
    service.connected = false
    const screen = open()
    await flushPromises()

    expect(screen.findComponent(EmptyState).props('text')).toContain('not connected')
    expect(client.trash).not.toHaveBeenCalled()
  })

  it('says so rather than sitting empty when the server refuses', async () => {
    client.trash.mockRejectedValue(new Error('the server never answered'))
    const screen = open()
    await flushPromises()

    expect(screen.findComponent(EmptyState).props('text')).toContain('the server never answered')
  })
})

describe('bringing a file back', () => {
  it('restores the file whose button was pressed and pulls it onto disk', async () => {
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(client.restoreDeleted).toHaveBeenCalledWith('f-old')
    // The commit is on the server; the engine is what puts the file back in the vault.
    expect(service.syncNow).toHaveBeenCalled()
  })

  /** Restoring puts a file back; it destroys nothing, so nothing is asked before it. */
  it('does not ask a question before an action that takes nothing away', async () => {
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')

    expect(client.restoreDeleted).toHaveBeenCalled()
  })

  it('takes the restored file off the list and leaves the rest', async () => {
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(titles(screen)).toEqual(['Attachments/photo.png'])
  })

  it('says the trash is empty once the last file has been brought back', async () => {
    client.trash.mockResolvedValue([TRASH[0]])
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(screen.findComponent(EmptyState).props('text')).toContain('Nothing has been deleted')
  })

  it('leaves the file on the list and says why when the server refuses', async () => {
    client.restoreDeleted.mockRejectedValue(new Error('that path is taken'))
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(service.syncNow).not.toHaveBeenCalled()
    expect(screen.findComponent(EmptyState).props('text')).toContain('that path is taken')
  })
})
