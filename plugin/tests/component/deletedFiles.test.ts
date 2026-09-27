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
import { Notice } from 'obsidian'
import type { CommitOpResult, TrashItem } from '@abele/sync-protocol'
import DeletedFilesModal from '@/components/sync/DeletedFilesModal.vue'
import Card from '@/components/obsidian/Card.vue'
import Badge from '@/components/obsidian/Badge.vue'
import Button from '@/components/obsidian/Button.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import RestoreSince from '@/components/sync/RestoreSince.vue'
import { SyncService } from '@/sync/SyncService'
import { DISCONNECTED_STATUS, type SyncStatus } from '@/sync/status'
import { useVault } from '../helpers/testEnv'

/** The dialog itself is Obsidian's; unwrapping it puts the body where a query can reach it. */
const STUBS = { ObsidianModal: { template: '<div><slot /></div>' }, Dropdown: true }

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

/** What the server answers a restore it accepted with. */
const applied = (path: string): CommitOpResult => ({
  status: 'applied',
  file_id: 'f-old',
  version_id: 'v10',
  seq: 10,
  path,
  sha: 'sha-10',
  size: 2048,
  mtime: 0,
})

/** And what it answers one it refused with — a 200, not a throw. */
const rejected = (message: string): CommitOpResult => ({
  status: 'rejected',
  code: 'conflict',
  message,
})

const client = {
  trash: vi.fn(),
  restoreDeleted: vi.fn(),
}

const service = {
  status: ref<SyncStatus>({ ...DISCONNECTED_STATUS }),
  connection: ref({ vaultId: 'v1' }),
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

const errorLine = (screen: Screen): string =>
  screen.find('.abele-deleted-files__error').exists()
    ? screen.find('.abele-deleted-files__error').text()
    : ''

beforeEach(() => {
  useVault([])
  Notice.shown.length = 0
  service.connected = true
  service.status.value = { ...DISCONNECTED_STATUS, state: 'idle' }
  client.trash.mockResolvedValue(TRASH)
  client.restoreDeleted.mockResolvedValue(applied('Notes/older.md'))
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('restoring everything deleted since a moment', () => {
  it('is offered over a trash with something in it, and takes what it restored off the list', async () => {
    const screen = open()
    await flushPromises()

    const since = screen.findComponent(RestoreSince)
    expect(since.props('items')).toHaveLength(2)
    since.vm.$emit('restored', ['f-new'])
    await flushPromises()

    expect(titles(screen)).toEqual(['Notes/older.md'])
  })

  it('is not offered over an empty trash', async () => {
    client.trash.mockResolvedValue([])
    const screen = open()
    await flushPromises()

    expect(screen.findComponent(RestoreSince).exists()).toBe(false)
  })
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

    expect(errorLine(screen)).toContain('the server never answered')
    // Not the empty state: nothing is known to be empty, only unreadable.
    expect(screen.findComponent(EmptyState).exists()).toBe(false)
  })
})

describe('bringing a file back', () => {
  it('restores the file whose button was pressed and pulls it onto disk', async () => {
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(client.restoreDeleted).toHaveBeenCalledWith('f-old', expect.any(String))
    // The commit is on the server; the engine is what puts the file back in the vault.
    expect(service.syncNow).toHaveBeenCalled()
  })

  /** A restore retried under the key it was first sent with is the first answer again. */
  it('sends a key of its own so a retried restore is not a second copy', async () => {
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(client.restoreDeleted.mock.calls[0][1]).toMatch(/[0-9a-f-]{8,}/)
  })

  /**
   * The path the file went to, not the one it came from: the old name may have been taken
   * since it was deleted, and then the server brings it back beside it under the next free one.
   */
  it('names the path the server actually brought the file back at', async () => {
    client.restoreDeleted.mockResolvedValue(applied('Notes/older 1.md'))
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(Notice.shown).toEqual(['Notes/older 1.md restored.'])
  })

  /**
   * While sync is paused the file is back on the server and nowhere else: the pull that would
   * bring it home does not run. Saying "restored" then sends somebody looking for it.
   */
  it('says the file comes back when sync resumes, while it is paused', async () => {
    client.restoreDeleted.mockResolvedValue(applied('Notes/older.md'))
    service.status.value = { ...DISCONNECTED_STATUS, state: 'paused' }
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(Notice.shown).toEqual([
      'Notes/older.md is back on the server; it reaches this device when sync is resumed.',
    ])
  })

  it('says the file comes back at the next sync, when the pull could not get through', async () => {
    client.restoreDeleted.mockResolvedValue(applied('Notes/older.md'))
    service.status.value = { ...DISCONNECTED_STATUS, state: 'offline' }
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(Notice.shown).toEqual([
      'Notes/older.md is back on the server; it reaches this device at the next sync that gets through.',
    ])
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

  /**
   * The one that matters most: the server says no by answering, not by failing. A dialog that
   * read only the exceptions would announce a refusal as a restore and take the file off the
   * list it is still sitting in.
   */
  it('keeps the file on the list and says why when the server refuses', async () => {
    client.restoreDeleted.mockResolvedValue(rejected('that path is taken'))
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(service.syncNow).not.toHaveBeenCalled()
    expect(Notice.shown).toEqual([])
    expect(titles(screen)).toContain('Notes/older.md')
    expect(errorLine(screen)).toContain('that path is taken')
  })

  it('keeps the file on the list and says why when the request itself fails', async () => {
    client.restoreDeleted.mockRejectedValue(new Error('the server never answered'))
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(service.syncNow).not.toHaveBeenCalled()
    expect(titles(screen)).toContain('Notes/older.md')
    expect(errorLine(screen)).toContain('the server never answered')
  })

  /**
   * Two Restores pressed back to back: the second is queued behind the first, and both rows say
   * what they are doing, rather than the second press going nowhere without a word.
   */
  it('queues a second Restore pressed while the first is running, and says so', async () => {
    let finish: (result: CommitOpResult) => void = () => undefined
    client.restoreDeleted
      .mockImplementationOnce(() => new Promise<CommitOpResult>((resolve) => (finish = resolve)))
      .mockResolvedValueOnce({ ...applied('Attachments/photo.png'), file_id: 'f-new' })
    const screen = open()
    await flushPromises()

    void restoreFor(screen, 'Notes/older.md')?.trigger('click')
    void restoreFor(screen, 'Attachments/photo.png')?.trigger('click')
    await flushPromises()

    expect(restoreFor(screen, 'Notes/older.md')?.props('text')).toBe('Restoring…')
    expect(restoreFor(screen, 'Attachments/photo.png')?.props('text')).toBe('Queued')
    expect(restoreFor(screen, 'Attachments/photo.png')?.props('disabled')).toBe(true)
    expect(client.restoreDeleted).toHaveBeenCalledTimes(1)

    finish(applied('Notes/older.md'))
    await flushPromises()

    expect(client.restoreDeleted).toHaveBeenCalledTimes(2)
    expect(client.restoreDeleted.mock.calls[1][0]).toBe('f-new')
    expect(titles(screen)).toEqual([])
    expect(Notice.shown).toEqual(['Notes/older.md restored.', 'Attachments/photo.png restored.'])
  })

  it('leaves the other rows pressable while one restores', async () => {
    client.restoreDeleted.mockImplementationOnce(() => new Promise<CommitOpResult>(() => undefined))
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 'Notes/older.md')?.trigger('click')
    await flushPromises()

    expect(restoreFor(screen, 'Attachments/photo.png')?.props('disabled')).toBe(false)
    expect(restoreFor(screen, 'Attachments/photo.png')?.props('text')).toBe('Restore')
  })
})
