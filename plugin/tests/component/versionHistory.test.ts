/**
 * One file's history, as the dialog behind "Open version history" shows it.
 *
 * The server keeps the versions and this device keeps only the id it knows the file by, so
 * what is asserted here is the joining of the two: the ledger says which file, the server says
 * what happened to it, and the vault says what the file holds now — which is what makes a
 * preview a diff rather than a dump. Nothing here talks to a server; the client and the
 * service are stand-ins whose shape is the shape the real ones publish.
 *
 * A restore is a commit, and a commit that the server refuses answers 200 with `rejected`
 * rather than throwing. Half of what follows is about that difference.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { Notice } from 'obsidian'
import type { CommitOpResult, VersionInfo } from '@abele/sync-protocol'
import VersionHistoryModal from '@/components/sync/VersionHistoryModal.vue'
import Card from '@/components/obsidian/Card.vue'
import Badge from '@/components/obsidian/Badge.vue'
import Button from '@/components/obsidian/Button.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { SyncService } from '@/sync/SyncService'
import { DISCONNECTED_STATUS, type SyncStatus } from '@/sync/status'
import { useVault } from '../helpers/testEnv'

/** The dialog itself is Obsidian's; unwrapping it puts the body where a query can reach it. */
const STUBS = { ObsidianModal: { template: '<div><slot /></div>' } }

const PATH = 'Notes/a.md'
/** What the note holds on this device, which is the right-hand side of every preview. */
const CURRENT = 'one\ntwo\n'

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString()

const version = (over: Partial<VersionInfo> & { no: number }): VersionInfo => ({
  version_id: `v${over.no}`,
  seq: over.no,
  op: 'modify',
  path: PATH,
  sha: `sha-${over.no}`,
  size: 1024,
  mtime: 0,
  actor: { kind: 'device', id: 'd1', name: 'Desktop' },
  at: minutesAgo(5),
  merge: null,
  ...over,
})

/**
 * Four versions, newest first as the server keeps them. `#4` is the one this device is at and
 * `#3` is a deletion: both are versions there is nothing to restore *to*, which is what the
 * disabled buttons below are about.
 */
const HISTORY: VersionInfo[] = [
  version({ no: 4, op: 'modify', actor: { kind: 'device', id: 'd1', name: 'Laptop' } }),
  version({ no: 3, op: 'delete', size: 0, sha: null }),
  version({ no: 2, op: 'restore', size: 2048 }),
  version({ no: 1, op: 'create' }),
]

const ENTRY = {
  path: PATH,
  wirePath: PATH,
  fileId: 'file-1',
  versionId: 'v4',
  sha: 'sha-4',
  size: 8,
  mtime: 0,
}

/** What the server answers a restore it accepted with. */
const APPLIED: CommitOpResult = {
  status: 'applied',
  file_id: 'file-1',
  version_id: 'v5',
  seq: 5,
  path: PATH,
  sha: 'sha-5',
  size: 1024,
  mtime: 0,
}

/** And what it answers one it refused with — a 200, not a throw. */
const rejected = (message: string): CommitOpResult => ({
  status: 'rejected',
  code: 'conflict',
  message,
})

const client = {
  versions: vi.fn(),
  versionBytes: vi.fn(),
  restore: vi.fn(),
}

const service = {
  status: ref<SyncStatus>({ ...DISCONNECTED_STATUS }),
  log: ref<string[]>([]),
  connected: true,
  isConnected: vi.fn(() => service.connected),
  client: vi.fn(() => (service.connected ? client : null)),
  entryFor: vi.fn(),
  syncNow: vi.fn(),
  note: vi.fn(),
}

const open = (path = PATH) =>
  mount(VersionHistoryModal, { props: { path }, global: { stubs: STUBS } })
type Screen = ReturnType<typeof open>

const titles = (screen: Screen): string[] =>
  screen.findAllComponents(Card).map((card) => card.props('title') as string)

const cardFor = (screen: Screen, no: number) =>
  screen.findAllComponents(Card).find((card) => card.props('title') === `#${no}`)

/** The Restore button of one version's card. */
const restoreFor = (screen: Screen, no: number) => cardFor(screen, no)?.findComponent(Button)

const diffLines = (screen: Screen): string[] =>
  screen.findAll('.abele-version-history__diff-line').map((line) => line.text())

const errorLine = (screen: Screen): string =>
  screen.find('.abele-version-history__error').exists()
    ? screen.find('.abele-version-history__error').text()
    : ''

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

/** Presses Restore on one version and answers the question it asks. */
const confirmRestore = async (screen: Screen, no: number): Promise<void> => {
  await restoreFor(screen, no)?.trigger('click')
  screen.findComponent(ConfirmModal).vm.$emit('confirm')
  await flushPromises()
}

beforeEach(() => {
  useVault([{ path: PATH, content: CURRENT }])
  Notice.shown.length = 0
  service.connected = true
  service.status.value = { ...DISCONNECTED_STATUS, state: 'idle' }
  service.entryFor.mockResolvedValue(ENTRY)
  client.versions.mockResolvedValue(HISTORY)
  client.versionBytes.mockResolvedValue(bytesOf('one\nTWO\n'))
  client.restore.mockResolvedValue(APPLIED)
  vi.spyOn(SyncService, 'getInstance').mockReturnValue(service as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('what has happened to a file', () => {
  it('asks the server about the id this device knows the file by', async () => {
    const screen = open()
    await flushPromises()

    expect(service.entryFor).toHaveBeenCalledWith(PATH)
    expect(client.versions).toHaveBeenCalledWith('file-1', { limit: 50 })
    expect(screen.findAllComponents(Card)).toHaveLength(4)
  })

  it('lists the versions newest first', async () => {
    const screen = open()
    await flushPromises()

    expect(titles(screen)).toEqual(['#4', '#3', '#2', '#1'])
  })

  it('says what each version did, who did it, when, and how big it left the file', async () => {
    const screen = open()
    await flushPromises()

    expect(screen.findAllComponents(Badge).map((b) => b.props('text'))).toEqual([
      'Edited',
      'Deleted',
      'Restored',
      'Created',
    ])
    expect(cardFor(screen, 4)?.props('meta')).toEqual(['Laptop', '5 minutes ago', '1.0 KB'])
    expect(cardFor(screen, 2)?.props('meta')).toContain('2.0 KB')
  })

  it('says a file nobody has synced has no history, rather than sitting empty', async () => {
    service.entryFor.mockResolvedValue(null)
    const screen = open()
    await flushPromises()

    expect(screen.findComponent(EmptyState).props('text')).toContain('has not been synced')
    expect(client.versions).not.toHaveBeenCalled()
  })

  it('says where a history lives when this device is not connected to a server', async () => {
    service.connected = false
    const screen = open()
    await flushPromises()

    expect(screen.findComponent(EmptyState).props('text')).toContain('not connected')
  })

  it('says so rather than sitting empty when the server refuses', async () => {
    client.versions.mockRejectedValue(new Error('the server never answered'))
    const screen = open()
    await flushPromises()

    expect(errorLine(screen)).toContain('the server never answered')
    // Not the empty state: nothing is known to be empty, only unreadable.
    expect(screen.findComponent(EmptyState).exists()).toBe(false)
  })

  /** The ledger is a database, and a database that will not open must not read for ever. */
  it('says so rather than reading for ever when the ledger cannot be opened', async () => {
    service.entryFor.mockRejectedValue(new Error('the ledger would not open'))
    const screen = open()
    await flushPromises()

    expect(errorLine(screen)).toContain('the ledger would not open')
    expect(screen.text()).not.toContain('Reading this file')
  })
})

describe('the preview', () => {
  it('shows a unified diff of the version against the file as it stands', async () => {
    const screen = open()
    await flushPromises()

    await cardFor(screen, 4)?.trigger('click')
    await flushPromises()

    expect(client.versionBytes).toHaveBeenCalledWith('file-1', 'v4')
    const lines = diffLines(screen)
    expect(lines[0]).toBe(`--- ${PATH} #4`)
    expect(lines[1]).toBe(`+++ ${PATH} as it is now`)
    // What the version said, and what the file says instead.
    expect(lines).toContain('-TWO')
    expect(lines).toContain('+two')
  })

  /** Fifty versions is fifty downloads; a person reads one or two of them. */
  it('fetches the bytes of a version only when somebody opens it', async () => {
    const screen = open()
    await flushPromises()

    expect(client.versionBytes).not.toHaveBeenCalled()

    await cardFor(screen, 2)?.trigger('click')
    await flushPromises()

    expect(client.versionBytes).toHaveBeenCalledTimes(1)
    expect(client.versionBytes).toHaveBeenCalledWith('file-1', 'v2')
  })

  it('closes a preview that is already open rather than fetching it again', async () => {
    const screen = open()
    await flushPromises()
    await cardFor(screen, 4)?.trigger('click')
    await flushPromises()

    await cardFor(screen, 4)?.trigger('click')
    await flushPromises()

    expect(diffLines(screen)).toEqual([])
    expect(client.versionBytes).toHaveBeenCalledTimes(1)
  })

  it('says so when a version holds exactly what the file holds now', async () => {
    client.versionBytes.mockResolvedValue(bytesOf(CURRENT))
    const screen = open()
    await flushPromises()

    await cardFor(screen, 4)?.trigger('click')
    await flushPromises()

    expect(screen.text()).toContain('exactly what the file says now')
  })

  /** Two versions of a picture differ; saying so line by line is a wall of bytes. */
  it.each(['Attachments/photo.png', 'my.notes/README', 'Recordings/take.mp3'])(
    'offers no preview at all for %s, which is not text',
    async (path) => {
      const screen = open(path)
      await flushPromises()

      expect(screen.findAllComponents(Card)[0].props('clickable')).toBe(false)
      await screen.findAllComponents(Card)[0].trigger('click')
      await flushPromises()

      expect(client.versionBytes).not.toHaveBeenCalled()
      expect(diffLines(screen)).toEqual([])
    }
  )

  it('offers a preview for a note inside a folder with a dot in its name', async () => {
    const screen = open('my.notes/a.md')
    await flushPromises()

    expect(screen.findAllComponents(Card)[0].props('clickable')).toBe(true)
    await screen.findAllComponents(Card)[0].trigger('click')
    await flushPromises()

    expect(client.versionBytes).toHaveBeenCalled()
  })

  it('says so rather than drawing question marks when the bytes are not text after all', async () => {
    client.versionBytes.mockResolvedValue(new Uint8Array([0x89, 0x00, 0x1a]))
    const screen = open()
    await flushPromises()

    await cardFor(screen, 4)?.trigger('click')
    await flushPromises()

    expect(screen.text()).toContain('not text')
    expect(diffLines(screen)).toEqual([])
  })
})

describe('what cannot be restored', () => {
  it('offers no restore for the version the file is already at', async () => {
    const screen = open()
    await flushPromises()

    expect(restoreFor(screen, 4)?.props('disabled')).toBe(true)
    expect(restoreFor(screen, 4)?.props('tooltip')).toContain('already the current version')
  })

  it('offers no restore for a version that deleted the file', async () => {
    const screen = open()
    await flushPromises()

    expect(restoreFor(screen, 3)?.props('disabled')).toBe(true)
    expect(restoreFor(screen, 3)?.props('tooltip')).toContain('no content to put back')
  })

  it('offers a restore for every version that has content behind it', async () => {
    const screen = open()
    await flushPromises()

    expect(restoreFor(screen, 2)?.props('disabled')).toBe(false)
    expect(restoreFor(screen, 1)?.props('disabled')).toBe(false)
  })
})

describe('putting an old version back', () => {
  it('asks first, rather than restoring on the click', async () => {
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 2)?.trigger('click')

    expect(client.restore).not.toHaveBeenCalled()
    expect(screen.findComponent(ConfirmModal).props('message')).toContain('#2')
  })

  it('restores that version and pulls it onto disk once the question is answered', async () => {
    const screen = open()
    await flushPromises()

    await confirmRestore(screen, 2)

    expect(client.restore).toHaveBeenCalledWith('file-1', 'v2', expect.any(String))
    // The commit is on the server; the engine is what puts the bytes back in the vault.
    expect(service.syncNow).toHaveBeenCalled()
    expect(screen.emitted('close')).toHaveLength(1)
  })

  it('says the version reaches the file when sync resumes, while it is paused', async () => {
    service.status.value = { ...DISCONNECTED_STATUS, state: 'paused' }
    const screen = open()
    await flushPromises()

    await confirmRestore(screen, 2)

    expect(Notice.shown).toEqual([
      `${PATH} is at version #2 on the server; it reaches this device when sync is resumed.`,
    ])
  })

  /** A restore retried under the key it was first sent with is the first answer again. */
  it('sends a key of its own so a retried restore is not a second version', async () => {
    const screen = open()
    await flushPromises()

    await confirmRestore(screen, 2)

    const key = client.restore.mock.calls[0][2] as string
    expect(key).toMatch(/[0-9a-f-]{8,}/)
  })

  it('restores the version whose button was pressed, not the newest', async () => {
    const screen = open()
    await flushPromises()

    await confirmRestore(screen, 1)

    expect(client.restore).toHaveBeenCalledWith('file-1', 'v1', expect.any(String))
  })

  /**
   * The one that matters most: the server says no by answering, not by failing. A dialog that
   * read only the exceptions would announce a refusal as a success and leave the person
   * looking for a note that never changed.
   */
  it('does not announce a refusal as a restore', async () => {
    client.restore.mockResolvedValue(rejected('that version has no content'))
    const screen = open()
    await flushPromises()

    await confirmRestore(screen, 2)

    expect(errorLine(screen)).toContain('that version has no content')
    expect(service.syncNow).not.toHaveBeenCalled()
    expect(Notice.shown).toEqual([])
    expect(screen.emitted('close')).toBeUndefined()
  })

  it('leaves the whole history readable after a refusal', async () => {
    client.restore.mockResolvedValue(rejected('that version has no content'))
    const screen = open()
    await flushPromises()

    await confirmRestore(screen, 2)

    expect(titles(screen)).toEqual(['#4', '#3', '#2', '#1'])
    expect(screen.findComponent(EmptyState).exists()).toBe(false)
  })

  it('says why rather than closing when the request itself fails', async () => {
    client.restore.mockRejectedValue(new Error('the server never answered'))
    const screen = open()
    await flushPromises()

    await confirmRestore(screen, 2)

    expect(service.syncNow).not.toHaveBeenCalled()
    expect(screen.emitted('close')).toBeUndefined()
    expect(errorLine(screen)).toContain('the server never answered')
    expect(titles(screen)).toHaveLength(4)
  })

  /** Restoring is about content. A move is not undone by putting an old version back. */
  it('says that restoring a move does not move the file back', async () => {
    client.versions.mockResolvedValue([
      HISTORY[0],
      version({ no: 2, op: 'move', path: 'Notes/old-name.md' }),
    ])
    const screen = open()
    await flushPromises()

    await restoreFor(screen, 2)?.trigger('click')

    const message = screen.findComponent(ConfirmModal).props('message') as string
    expect(message).toContain('Notes/old-name.md')
    expect(message).toContain('the move itself is not undone')
  })
})
