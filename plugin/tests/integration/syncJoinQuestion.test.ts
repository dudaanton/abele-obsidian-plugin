import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import type { Usage } from '@abele/sync-protocol'
import { countHere, countThere, joinKind, keptLedger, type FileCount } from '@/sync/join'
import { defaultSelective } from '@/sync/connection'
import { IndexedDbStateStore, stateDatabaseName } from '@/sync/IndexedDbStateStore'
import { writeLedgerId } from '@/sync/ledgerId'
import { buildFakeVault } from '../helpers/fakeVault'

/**
 * What the join dialog is told before it asks anything: how many files each side holds, and
 * whether this vault already walked the server's to the end once (a reconnect).
 *
 * Which question is asked follows from those three facts alone (plan decision 7):
 * - files on both sides → which side wins where both have a file;
 * - files on one side → a plain confirmation that says which way they go;
 * - a ledger for this vault that got to the end → it picks up where it left off, nothing to ask.
 */

const none: FileCount = { files: 0, settings: 0 }
const some: FileCount = { files: 3, settings: 1 }

const usage = (byKind: Usage['by_kind']): Usage => ({
  live_bytes: 0,
  history_bytes: 0,
  trash_bytes: 0,
  quota_bytes: null,
  by_kind: byKind,
})

describe('which question a join asks', () => {
  it('asks which side wins when both sides hold files', () => {
    expect(joinKind(some, some, false)).toBe('choose')
  })

  it('confirms an upload when only this vault holds files', () => {
    expect(joinKind(some, none, false)).toBe('upload')
  })

  it('confirms a download when only the server holds files', () => {
    expect(joinKind(none, some, false)).toBe('download')
  })

  it('confirms a plain connect when neither side holds anything', () => {
    expect(joinKind(none, none, false)).toBe('empty')
  })

  it('asks nothing of a vault this device already walked to the end', () => {
    expect(joinKind(some, some, true)).toBe('reconnect')
  })

  /** A server that could not be counted may hold anything: the question is asked, not skipped. */
  it('asks which side wins when the server could not be counted and this vault has files', () => {
    expect(joinKind(some, null, false)).toBe('choose')
    expect(joinKind(none, null, false)).toBe('download')
  })
})

describe("the server's files", () => {
  it('counts the live files of every kind, the settings among them apart', () => {
    const counted = countThere(
      usage({
        note: { live_bytes: 10, count: 1200 },
        attachment: { live_bytes: 10, count: 30 },
        settings: { live_bytes: 10, count: 12 },
      })
    )

    expect(counted).toEqual({ files: 1242, settings: 12 })
  })

  it('counts nothing in a vault that holds nothing', () => {
    expect(countThere(usage({}))).toEqual(none)
  })
})

describe("this vault's files", () => {
  const vault = () =>
    buildFakeVault([
      { path: 'Note.md', content: 'a', mtime: 1 },
      { path: 'Archive/Old.md', content: 'b', mtime: 1 },
      { path: 'pic.png', content: 'c', mtime: 1 },
      { path: '.obsidian/app.json', content: '{}', mtime: 1 },
      { path: '.obsidian/workspace.json', content: '{}', mtime: 1 },
      { path: '.git/HEAD', content: 'ref', mtime: 1 },
      { path: '.abele-sync-ignore', content: 'Archive/\n', mtime: 1 },
    ]) as unknown as App

  it('counts only what this device would sync: its switches, the ignore file, no hidden paths', async () => {
    const selective = { ...defaultSelective(), images: false }

    // Note.md and app.json: the picture is switched off, Archive is ignored, the workspace
    // never syncs, and nothing under .git is Obsidian's to see.
    expect(await countHere(vault(), selective, 'Scripts')).toEqual({ files: 2, settings: 1 })
  })

  it('counts no settings on a device that does not sync them', async () => {
    const selective = defaultSelective()
    selective.settings.main = false

    expect(await countHere(vault(), selective, 'Scripts')).toEqual({ files: 2, settings: 0 })
  })
})

describe('a ledger this vault already has', () => {
  it('is kept when it is for this vault and got past the start of the feed', async () => {
    const factory = new IDBFactory()
    const app = buildFakeVault([]) as unknown as App
    writeLedgerId(app, { stateId: 'state-1', vaultId: 'v1' })
    const store = await IndexedDbStateStore.open(factory, stateDatabaseName('state-1'))
    await store.setCursor(12)
    store.close()

    expect(await keptLedger(app, factory, 'v1')).toBe(true)
    expect(await keptLedger(app, factory, 'v2')).toBe(false)
  })

  /** A join cut off before its first sync got through has not walked the server's files yet. */
  it('is not kept while its cursor is still at the start', async () => {
    const factory = new IDBFactory()
    const app = buildFakeVault([]) as unknown as App
    writeLedgerId(app, { stateId: 'state-1', vaultId: 'v1' })

    expect(await keptLedger(app, factory, 'v1')).toBe(false)
  })

  it('is not there on a vault that never synced', async () => {
    expect(await keptLedger(buildFakeVault([]) as unknown as App, new IDBFactory(), 'v1')).toBe(
      false
    )
  })
})
