/**
 * One file's history, as the dialog behind "Open version history" shows it.
 *
 * The server keeps the versions and this device keeps only the id it knows the file by, so
 * what is asserted here is the joining of the two: the ledger says which file, the server says
 * what happened to it, and the vault says what the file holds now — which is what makes a
 * preview a diff rather than a dump. Nothing here talks to a server; the client and the
 * service are stand-ins whose shape is the shape the real ones publish.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import type { VersionInfo } from '@abele/sync-protocol'
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

const HISTORY: VersionInfo[] = [
  version({ no: 3, op: 'modify', actor: { kind: 'device', id: 'd1', name: 'Laptop' } }),
  version({ no: 2, op: 'restore', size: 2048 }),
  version({ no: 1, op: 'create' }),
]

const ENTRY = {
  path: PATH,
  wirePath: PATH,
  fileId: 'file-1',
  versionId: 'v3',
  sha: 'sha-3',
  size: 8,
  mtime: 0,
}

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

const buttonNamed = (screen: Screen, text: string) =>
  screen.findAllComponents(Button).find((b) => b.props('text') === text)

const diffLines = (screen: Screen): string[] =>
  screen.findAll('.abele-version-history__diff-line').map((line) => line.text())

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

beforeEach(() => {
  useVault([{ path: PATH, content: CURRENT }])
  service.connected = true
  service.entryFor.mockResolvedValue(ENTRY)
  client.versions.mockResolvedValue(HISTORY)
  client.versionBytes.mockResolvedValue(bytesOf('one\nTWO\n'))
  client.restore.mockResolvedValue({ status: 'applied' })
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
    expect(screen.findAllComponents(Card)).toHaveLength(3)
  })

  it('lists the versions newest first', async () => {
    const screen = open()
    await flushPromises()

    expect(titles(screen)).toEqual(['#3', '#2', '#1'])
  })

  it('says what each version did, who did it, when, and how big it left the file', async () => {
    const screen = open()
    await flushPromises()

    expect(screen.findAllComponents(Badge).map((b) => b.props('text'))).toEqual([
      'Edited',
      'Restored',
      'Created',
    ])
    expect(screen.findAllComponents(Card)[0].props('meta')).toEqual([
      'Laptop',
      '5 minutes ago',
      '1.0 KB',
    ])
    expect(screen.findAllComponents(Card)[1].props('meta')).toContain('2.0 KB')
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

    expect(screen.findComponent(EmptyState).props('text')).toContain('the server never answered')
  })
})

describe('the preview', () => {
  it('shows a unified diff of the version against the file as it stands', async () => {
    const screen = open()
    await flushPromises()

    await screen.findAllComponents(Card)[0].trigger('click')
    await flushPromises()

    expect(client.versionBytes).toHaveBeenCalledWith('file-1', 'v3')
    const lines = diffLines(screen)
    expect(lines[0]).toBe(`--- ${PATH} #3`)
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

    await screen.findAllComponents(Card)[1].trigger('click')
    await flushPromises()

    expect(client.versionBytes).toHaveBeenCalledTimes(1)
    expect(client.versionBytes).toHaveBeenCalledWith('file-1', 'v2')
  })

  it('closes a preview that is already open rather than fetching it again', async () => {
    const screen = open()
    await flushPromises()
    await screen.findAllComponents(Card)[0].trigger('click')
    await flushPromises()

    await screen.findAllComponents(Card)[0].trigger('click')
    await flushPromises()

    expect(diffLines(screen)).toEqual([])
    expect(client.versionBytes).toHaveBeenCalledTimes(1)
  })

  it('says so when a version holds exactly what the file holds now', async () => {
    client.versionBytes.mockResolvedValue(bytesOf(CURRENT))
    const screen = open()
    await flushPromises()

    await screen.findAllComponents(Card)[0].trigger('click')
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

    await screen.findAllComponents(Card)[0].trigger('click')
    await flushPromises()

    expect(screen.text()).toContain('not text')
    expect(diffLines(screen)).toEqual([])
  })
})

describe('putting an old version back', () => {
  it('asks first, rather than restoring on the click', async () => {
    const screen = open()
    await flushPromises()

    await buttonNamed(screen, 'Restore')?.trigger('click')

    expect(client.restore).not.toHaveBeenCalled()
    expect(screen.findComponent(ConfirmModal).props('message')).toContain('#3')
  })

  it('restores that version and pulls it onto disk once the question is answered', async () => {
    const screen = open()
    await flushPromises()
    await buttonNamed(screen, 'Restore')?.trigger('click')

    screen.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(client.restore).toHaveBeenCalledWith('file-1', 'v3')
    // The commit is on the server; the engine is what puts the bytes back in the vault.
    expect(service.syncNow).toHaveBeenCalled()
    expect(screen.emitted('close')).toHaveLength(1)
  })

  it('restores the version whose button was pressed, not the newest', async () => {
    const screen = open()
    await flushPromises()
    const buttons = screen.findAllComponents(Button).filter((b) => b.props('text') === 'Restore')
    await buttons[2].trigger('click')

    screen.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(client.restore).toHaveBeenCalledWith('file-1', 'v1')
  })

  it('says why rather than closing when the server refuses the restore', async () => {
    client.restore.mockRejectedValue(new Error('that version has been swept'))
    const screen = open()
    await flushPromises()
    await buttonNamed(screen, 'Restore')?.trigger('click')

    screen.findComponent(ConfirmModal).vm.$emit('confirm')
    await flushPromises()

    expect(service.syncNow).not.toHaveBeenCalled()
    expect(screen.emitted('close')).toBeUndefined()
    expect(screen.findComponent(EmptyState).props('text')).toContain('that version has been swept')
  })
})
