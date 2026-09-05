/**
 * The engine's `FileSystem`, over Obsidian's vault.
 *
 * Everything here runs against `buildFakeVault`, which models the two halves the adapter has
 * to reconcile: the file index that `getFiles()` returns, and the disk under it that holds
 * the configuration folder the index never shows. The fake's disk is case-folding, like the
 * ones this plugin actually runs on, which is what makes the case-only rename a real test
 * rather than a spelling exercise.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { normalizePath, type App } from 'obsidian'
import { EngineError, type FileInfo } from '@abele/sync-core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault, type FakeApp, type FakeFileSpec } from '../helpers/fakeVault'

const POLL_MS = 1000

let app: FakeApp

function useVault(specs: FakeFileSpec[]): ObsidianFileSystem {
  app = buildFakeVault(specs)
  return new ObsidianFileSystem(app as unknown as App, { pollMs: POLL_MS })
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const read = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

async function listed(fs: ObsidianFileSystem): Promise<FileInfo[]> {
  const out: FileInfo[] = []
  for await (const info of fs.list()) out.push(info)
  return out
}

/** What the engine got told, batch by batch. */
function watched(fs: ObsidianFileSystem): { batches: string[][]; stop: () => void } {
  const batches: string[][] = []
  const stop = fs.watch((paths) => batches.push([...paths].sort()))
  return { batches, stop }
}

/** The code an `EngineError` carried, or the error itself when it is not one. */
async function codeOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run
    return 'no error'
  } catch (error) {
    return error instanceof EngineError ? error.code : error
  }
}

const VAULT: FakeFileSpec[] = [
  { path: 'Note.md', content: 'first', mtime: 1000, ctime: 900 },
  { path: 'Notes/Deep/second.md', content: 'second body', mtime: 2000, ctime: 900 },
  { path: '.obsidian/app.json', content: '{"a":1}', mtime: 3000, ctime: 900 },
  { path: '.obsidian/plugins/abele/data.json', content: '{"b":2}', mtime: 4000, ctime: 900 },
]

describe('ObsidianFileSystem — listing', () => {
  it('reports vault files with the numbers the file index already holds', async () => {
    const fs = useVault(VAULT)
    const infos = await listed(fs)
    expect(infos.find((info) => info.path === 'Note.md')).toEqual({
      path: 'Note.md',
      size: 5,
      mtime: 1000,
    })
    expect(infos.find((info) => info.path === 'Notes/Deep/second.md')?.mtime).toBe(2000)
  })

  it('walks the configuration folder, which the file index never shows', async () => {
    const fs = useVault(VAULT)
    const paths = (await listed(fs)).map((info) => info.path).sort()
    expect(paths).toEqual([
      '.obsidian/app.json',
      '.obsidian/plugins/abele/data.json',
      'Note.md',
      'Notes/Deep/second.md',
    ])
    expect(app.vault.getFiles().map((file) => file.path)).not.toContain('.obsidian/app.json')
  })

  it('yields folders never, and a vault with no configuration folder all the same', async () => {
    const fs = useVault([{ path: 'Notes/Deep/second.md', content: 'x' }])
    const paths = (await listed(fs)).map((info) => info.path)
    expect(paths).toEqual(['Notes/Deep/second.md'])
  })

  it('fails the listing rather than calling a folder it cannot read empty', async () => {
    const fs = useVault(VAULT)
    // A folder that is there and will not be listed. Answering "no files" would have the
    // scanner tell the server every settings file had been deleted.
    app.vault.adapter.list = async (path: string) => {
      throw new Error(`EACCES: ${path}`)
    }
    await expect(codeOf(listed(fs))).resolves.toBe('io')
  })

  it('stops following a folder that leads back into itself', async () => {
    const fs = useVault(VAULT)
    const real = app.vault.adapter.list.bind(app.vault.adapter)
    let descents = 0
    // A symlinked plugin folder pointing at an ancestor: every listing has one more folder
    // under it and the walk has no bottom of its own.
    app.vault.adapter.list = async (path: string) => {
      if (path.startsWith('.obsidian/loop')) {
        descents++
        return { files: [], folders: [`${path}/loop`] }
      }
      const listing = await real(path)
      if (path !== '.obsidian') return listing
      return { files: listing.files, folders: [...listing.folders, '.obsidian/loop'] }
    }

    const paths = (await listed(fs)).map((info) => info.path)
    expect(paths).toContain('Note.md')
    expect(paths).toContain('.obsidian/app.json')
    // It went down, and it stopped: deep enough to be a walk, short of for ever.
    expect(descents).toBeGreaterThan(4)
    expect(descents).toBeLessThan(40)
  })
})

describe('ObsidianFileSystem — reading and writing', () => {
  it('reads a note and a settings file as bytes', async () => {
    const fs = useVault(VAULT)
    expect(read(await fs.read('Note.md'))).toBe('first')
    expect(read(await fs.read('.obsidian/app.json'))).toBe('{"a":1}')
  })

  it('calls a missing file an io failure', async () => {
    const fs = useVault(VAULT)
    await expect(codeOf(fs.read('nowhere.md'))).resolves.toBe('io')
  })

  it('writes through folders that are not there yet, with the mtime it was given', async () => {
    const fs = useVault(VAULT)
    await fs.writeAtomic('New/Deeper/third.md', text('third'), 7000)
    expect(await fs.stat('New/Deeper/third.md')).toEqual({
      path: 'New/Deeper/third.md',
      size: 5,
      mtime: 7000,
    })
    expect(read(await fs.read('New/Deeper/third.md'))).toBe('third')
    // The write reached the file index too, which is where the next scan reads sizes from.
    expect(app.vault.getFiles().map((file) => file.path)).toContain('New/Deeper/third.md')
  })

  it('overwrites a file it wrote before', async () => {
    const fs = useVault(VAULT)
    await fs.writeAtomic('Note.md', text('second'), 8000)
    expect(read(await fs.read('Note.md'))).toBe('second')
    expect((await fs.stat('Note.md'))?.mtime).toBe(8000)
  })

  it('writes only the window of a view onto a larger buffer', async () => {
    const fs = useVault(VAULT)
    const whole = text('---kept---')
    await fs.writeAtomic('slice.md', whole.subarray(3, 7), 1)
    expect(read(await fs.read('slice.md'))).toBe('kept')
  })

  it('writes into a new folder on a host whose mkdir makes one folder at a time', async () => {
    const fs = useVault(VAULT)
    const made = app.vault.adapter.mkdir.bind(app.vault.adapter)
    app.vault.adapter.mkdir = async (path: string) => {
      const cut = path.lastIndexOf('/')
      const parent = cut === -1 ? '' : path.slice(0, cut)
      if (!(await app.vault.adapter.exists(parent))) throw new Error(`ENOENT: ${parent}`)
      await made(path)
    }
    await fs.writeAtomic('A/B/C/deep.md', text('deep'), 5)
    expect(read(await fs.read('A/B/C/deep.md'))).toBe('deep')
  })

  it('calls a folder where a file was expected a conflict, not a failure', async () => {
    const fs = useVault(VAULT)
    await expect(codeOf(fs.writeAtomic('Notes', text('x'), 1))).resolves.toBe('conflict')
  })
})

describe('ObsidianFileSystem — the names it is given', () => {
  const NBSP = '\u00a0'

  it('writes, lists and stats a non-breaking space unchanged', async () => {
    const fs = useVault(VAULT)
    const note = `Trips/Trip A${NBSP}B.md`
    const settings = `.obsidian/Trip A${NBSP}B.json`
    // What `normalizePath` would have done to both, which is why neither goes through it.
    expect(normalizePath(note)).not.toBe(note)

    await fs.writeAtomic(note, text('north'), 11)
    await fs.writeAtomic(settings, text('{}'), 12)

    const paths = (await listed(fs)).map((info) => info.path)
    expect(paths).toContain(note)
    expect(paths).toContain(settings)
    expect(await fs.stat(note)).toEqual({ path: note, size: 5, mtime: 11 })
    expect(read(await fs.read(note))).toBe('north')
    // And nothing landed under the tidied-up name beside it.
    expect(paths).not.toContain(normalizePath(note))
  })

  it('moves a name with a non-breaking space in it without tidying either end', async () => {
    const fs = useVault(VAULT)
    const from = `Trip A${NBSP}B.md`
    const to = `Trip C${NBSP}D.md`
    await fs.writeAtomic(from, text('north'), 11)
    await fs.move(from, to)
    expect(await fs.stat(from)).toBeNull()
    expect((await fs.stat(to))?.path).toBe(to)
  })
})

describe('ObsidianFileSystem — moving and removing', () => {
  it('moves a file, creating the folders on the way', async () => {
    const fs = useVault(VAULT)
    await fs.move('Note.md', 'Archive/2026/Note.md')
    expect(await fs.stat('Note.md')).toBeNull()
    expect(read(await fs.read('Archive/2026/Note.md'))).toBe('first')
  })

  it('holds a move onto a name that is taken, rather than failing the sync', async () => {
    const fs = useVault(VAULT)
    // `conflict`, because that is the only code the puller holds a change for.
    await expect(codeOf(fs.move('Note.md', 'Notes/Deep/second.md'))).resolves.toBe('conflict')
    expect(read(await fs.read('Notes/Deep/second.md'))).toBe('second body')
  })

  it('takes the new spelling in two steps when one rename will not do it', async () => {
    const fs = useVault(VAULT)
    // A mount that reads rename(2) between two names of one file as doing nothing at all.
    const renamed = app.vault.adapter.rename.bind(app.vault.adapter)
    let refusals = 0
    app.vault.adapter.rename = async (from: string, to: string) => {
      if (from !== to && from.toLowerCase() === to.toLowerCase()) {
        refusals++
        return
      }
      await renamed(from, to)
    }

    await fs.move('Note.md', 'note.md')

    expect(refusals).toBe(1)
    expect(read(await fs.read('note.md'))).toBe('first')
    expect(await app.vault.adapter.exists('note.md', true)).toBe(true)
    // Nothing of the adapter's own is left behind in the vault.
    const paths = (await listed(fs)).map((info) => info.path)
    expect(paths.filter((path) => path.includes('abele-sync'))).toEqual([])
  })

  it('holds a rename the disk will not make at all', async () => {
    const fs = useVault(VAULT)
    app.vault.adapter.rename = async (from: string, to: string) => {
      if (from.toLowerCase() === to.toLowerCase()) return
      throw new Error(`this disk will not rename ${from} to ${to}`)
    }
    await expect(codeOf(fs.move('Note.md', 'note.md'))).resolves.toBe('conflict')
  })

  it('renames a file into another spelling of its own name', async () => {
    const fs = useVault(VAULT)
    await fs.move('Note.md', 'note.md')
    const paths = (await listed(fs)).map((info) => info.path)
    expect(paths).toContain('note.md')
    expect(paths).not.toContain('Note.md')
    expect(read(await fs.read('note.md'))).toBe('first')
  })

  it('renames though the disk it runs on cannot tell the two names apart', async () => {
    const fs = useVault(VAULT)
    // The property the adapter must not lean on, pinned here so the test above means what it
    // says: this disk folds case, so `exists` answers for a spelling it does not hold.
    expect(await app.vault.adapter.exists('note.md')).toBe(true)
    expect(await app.vault.adapter.exists('note.md', true)).toBe(false)
    await fs.move('Note.md', 'note.md')
    expect(await app.vault.adapter.exists('note.md', true)).toBe(true)
  })

  it('moves nothing when both ends are one name, and says so when there is no file', async () => {
    const fs = useVault(VAULT)
    await expect(fs.move('Note.md', 'Note.md')).resolves.toBeUndefined()
    expect(read(await fs.read('Note.md'))).toBe('first')
    await expect(codeOf(fs.move('gone.md', 'gone.md'))).resolves.toBe('io')
  })

  it('calls a folder at either end a conflict', async () => {
    const fs = useVault(VAULT)
    await expect(codeOf(fs.move('Notes', 'Elsewhere.md'))).resolves.toBe('conflict')
    await expect(codeOf(fs.move('Note.md', 'Notes'))).resolves.toBe('conflict')
  })

  it('removes a file and shrugs at one that is already gone', async () => {
    const fs = useVault(VAULT)
    await fs.remove('Note.md')
    expect(await fs.stat('Note.md')).toBeNull()
    await expect(fs.remove('Note.md')).resolves.toBeUndefined()
    await expect(fs.remove('never/there.md')).resolves.toBeUndefined()
  })

  it('refuses to remove a folder', async () => {
    const fs = useVault(VAULT)
    await expect(codeOf(fs.remove('Notes'))).resolves.toBe('conflict')
  })

  it('stats a file, and a folder as nothing', async () => {
    const fs = useVault(VAULT)
    expect(await fs.stat('.obsidian/app.json')).toEqual({
      path: '.obsidian/app.json',
      size: 7,
      mtime: 3000,
    })
    expect(await fs.stat('Notes')).toBeNull()
    expect(await fs.stat('nowhere.md')).toBeNull()
  })
})

describe('ObsidianFileSystem — watching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Lets the watcher take its first look at the configuration folder. */
  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0)
  }

  it('collects a burst of vault events into one batch', async () => {
    const fs = useVault(VAULT)
    const { batches, stop } = watched(fs)
    await settle()

    app.emit('vault', 'modify', app.vault.getFileByPath('Note.md'))
    app.emit('vault', 'create', app.vault.getFileByPath('Notes/Deep/second.md'))
    await vi.advanceTimersByTimeAsync(200)
    expect(batches).toEqual([])

    await vi.advanceTimersByTimeAsync(100)
    expect(batches).toEqual([['Note.md', 'Notes/Deep/second.md']])
    stop()
  })

  it('hands over what it has when a burst never lets up', async () => {
    const fs = useVault(VAULT)
    const { batches, stop } = watched(fs)
    await settle()

    // One event every 200 ms for four seconds: the debounce alone would hold everything to
    // the end, so the ceiling is what makes the engine hear about the first ones at all.
    for (let i = 0; i < 20; i++) {
      app.emit('vault', 'modify', app.vault.getFileByPath('Note.md'))
      await vi.advanceTimersByTimeAsync(200)
    }
    expect(batches.length).toBeGreaterThan(0)
    expect(batches[0]).toEqual(['Note.md'])
    stop()
  })

  it('reports a rename under both of its names', async () => {
    const fs = useVault(VAULT)
    const { batches, stop } = watched(fs)
    await settle()

    await app.fileManager.renameFile(app.vault.getFileByPath('Note.md')!, 'Renamed.md')
    app.emit('vault', 'rename', app.vault.getFileByPath('Renamed.md'), 'Note.md')
    await vi.advanceTimersByTimeAsync(300)

    expect(batches).toEqual([['Note.md', 'Renamed.md']])
    stop()
  })

  it('names every note under a folder Obsidian only named once', async () => {
    const fs = useVault([
      { path: 'Trips/a.md', content: 'a' },
      { path: 'Trips/b.md', content: 'b' },
    ])
    const { batches, stop } = watched(fs)
    await settle()

    app.emit('vault', 'rename', app.vault.getAbstractFileByPath('Trips'), 'Voyages')
    await vi.advanceTimersByTimeAsync(300)

    expect(batches).toEqual([
      ['Trips', 'Trips/a.md', 'Trips/b.md', 'Voyages', 'Voyages/a.md', 'Voyages/b.md'],
    ])
    stop()
  })

  it('notices a settings file the vault said nothing about', async () => {
    const fs = useVault(VAULT)
    const { batches, stop } = watched(fs)
    await settle()

    await app.vault.adapter.writeBinary('.obsidian/app.json', text('{"a":2}').buffer, {
      mtime: 9000,
    })
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(batches).toEqual([['.obsidian/app.json']])
    stop()
  })

  it('notices a settings file that appeared and one that went', async () => {
    const fs = useVault(VAULT)
    const { batches, stop } = watched(fs)
    await settle()

    await app.vault.adapter.writeBinary('.obsidian/hotkeys.json', text('{}').buffer, { mtime: 1 })
    await app.vault.adapter.remove('.obsidian/app.json')
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(batches).toEqual([['.obsidian/app.json', '.obsidian/hotkeys.json']])
    stop()
  })

  it('says nothing when the configuration folder has not moved', async () => {
    const fs = useVault(VAULT)
    const { batches, stop } = watched(fs)
    await settle()

    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(batches).toEqual([])
    stop()
  })

  it('looks now when the settings tab kicks it, without waiting for the tick', async () => {
    const fs = useVault(VAULT)
    const { batches, stop } = watched(fs)
    await settle()

    await app.vault.adapter.writeBinary('.obsidian/app.json', text('{"a":3}').buffer, {
      mtime: 9100,
    })
    fs.kick()
    await settle()

    expect(batches).toEqual([['.obsidian/app.json']])
    stop()
  })

  it('looks now when Obsidian says the CSS changed', async () => {
    const fs = useVault(VAULT)
    const { batches, stop } = watched(fs)
    await settle()

    await app.vault.adapter.writeBinary('.obsidian/appearance.json', text('{}').buffer, {
      mtime: 5,
    })
    app.emit('workspace', 'css-change')
    await settle()

    expect(batches).toEqual([['.obsidian/appearance.json']])
    stop()
  })

  it('moves on from a batch its listener threw at', async () => {
    const fs = useVault(VAULT)
    const batches: string[][] = []
    const stop = fs.watch((paths) => {
      batches.push([...paths].sort())
      if (batches.length === 1) throw new Error('the engine was busy')
    })
    await settle()

    await app.vault.adapter.writeBinary('.obsidian/app.json', text('{"a":5}').buffer, {
      mtime: 9300,
    })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(batches).toEqual([['.obsidian/app.json']])

    await app.vault.adapter.writeBinary('.obsidian/hotkeys.json', text('{}').buffer, { mtime: 3 })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    // The second batch is the second file alone: the first was spent, thrown at or not.
    expect(batches).toEqual([['.obsidian/app.json'], ['.obsidian/hotkeys.json']])
    stop()
  })

  it('says nothing at all when the configuration folder will not be read', async () => {
    const fs = useVault(VAULT)
    const { batches, stop } = watched(fs)
    await settle()

    app.vault.adapter.list = async (path: string) => {
      throw new Error(`EACCES: ${path}`)
    }
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)

    expect(batches).toEqual([])
    stop()
  })

  it('kicking when nobody watches does nothing at all', () => {
    const fs = useVault(VAULT)
    expect(() => fs.kick()).not.toThrow()
  })

  it('stops both halves when it is told to', async () => {
    const fs = useVault(VAULT)
    const { batches, stop } = watched(fs)
    await settle()
    stop()

    app.emit('vault', 'modify', app.vault.getFileByPath('Note.md'))
    await app.vault.adapter.writeBinary('.obsidian/app.json', text('{"a":4}').buffer, {
      mtime: 9200,
    })
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)

    expect(batches).toEqual([])
  })
})
