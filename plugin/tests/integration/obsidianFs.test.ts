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

  it('lists a pulled note before Obsidian has indexed its adapter rename', async () => {
    const fs = useVault(VAULT)
    await fs.writeAtomic('Pulled.md', text('from server'), 7000)
    const index = app.vault.getFiles.bind(app.vault)
    // The disk has the file, but the file index catches up after the engine's next scan.
    let indexing = false
    app.vault.getFiles = () => index().filter((file) => indexing || file.path !== 'Pulled.md')
    expect((await listed(fs)).find((file) => file.path === 'Pulled.md')).toEqual({
      path: 'Pulled.md',
      size: 11,
      mtime: 7000,
    })
    indexing = true
    expect((await listed(fs)).filter((file) => file.path === 'Pulled.md')).toHaveLength(1)
    indexing = false
    await app.vault.adapter.remove('Pulled.md')
    expect((await listed(fs)).map((file) => file.path)).not.toContain('Pulled.md')
  })

  it('aborts listing on a pulled file stat error and retries that path after access returns', async () => {
    const fs = useVault(VAULT)
    await fs.writeAtomic('Pending.md', text('pending'), 7000)
    const files = app.vault.getFiles.bind(app.vault)
    app.vault.getFiles = () => files().filter((file) => file.path !== 'Pending.md')
    const stat = app.vault.adapter.stat.bind(app.vault.adapter)
    app.vault.adapter.stat = async (path) => {
      if (path === 'Pending.md')
        throw Object.assign(new Error('temporary failure'), { code: 'EIO' })
      return stat(path)
    }
    await expect(codeOf(listed(fs))).resolves.toBe('io')
    app.vault.adapter.stat = stat
    expect((await listed(fs)).map((file) => file.path)).toContain('Pending.md')
  })

  it('accepts confirmed ENOENT but propagates unknown stat failures', async () => {
    const fs = useVault(VAULT)
    app.vault.adapter.stat = async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }
    expect(await fs.stat('Absent.md')).toBeNull()
    app.vault.adapter.stat = async () => {
      throw new Error('adapter unavailable')
    }
    await expect(codeOf(fs.stat('Note.md'))).resolves.toBe('io')
  })

  it('uses the actual spelling after a local case-only rename before a pulled file was indexed', async () => {
    const fs = useVault(VAULT)
    await fs.writeAtomic('Report.md', text('report'), 7000)
    await app.vault.adapter.rename('Report.md', 'report.md')
    const names = (await listed(fs)).map((file) => file.path)
    expect(names).toContain('report.md')
    expect(names).not.toContain('Report.md')
    expect((await listed(fs)).map((file) => file.path)).not.toContain('Report.md')
  })

  it('finds a case-renamed ledger path by its disk spelling even before either spelling is indexed', async () => {
    app = buildFakeVault(VAULT)
    const fs = new ObsidianFileSystem(app as unknown as App, {
      ledger: {
        async *all() {
          yield {
            path: 'Report.md',
            wirePath: 'Report.md',
            fileId: 'file',
            versionId: 'version',
            sha: 'sha',
            size: 6,
            mtime: 7000,
          }
        },
      },
    })
    await fs.writeAtomic('Report.md', text('report'), 7000)
    await app.vault.adapter.rename('Report.md', 'report.md')
    const files = app.vault.getFiles.bind(app.vault)
    app.vault.getFiles = () => files().filter((file) => file.path !== 'report.md')
    for (let scan = 0; scan < 2; scan++) {
      const names = (await listed(fs)).map((file) => file.path)
      expect(names).toContain('report.md')
      expect(names).not.toContain('Report.md')
    }
  })

  it('does not scan a partially completed folder deletion while the watcher runs', async () => {
    const fs = useVault(VAULT)
    let release!: () => void
    const deleting = new Promise<void>((resolve) => {
      release = resolve
    })
    app.vault.delete = async () => {
      await app.vault.adapter.remove('Notes/Deep/second.md')
      await deleting
      await app.vault.adapter.remove('Note.md')
    }
    const stop = fs.watch(() => undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let finished = false
    try {
      const removal = app.vault.delete(app.vault.getAbstractFileByPath('Notes') as never)
      const scan = listed(fs).then((files) => {
        finished = true
        return files
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(finished).toBe(false)
      release()
      await removal
      const names = (await scan).map((file) => file.path)
      expect(names).not.toContain('Note.md')
      expect(names).not.toContain('Notes/Deep/second.md')
    } finally {
      release()
      stop()
      vi.useRealTimers()
    }
  })

  it('aborts a listing if a folder deletion starts after the listing already yielded a file', async () => {
    const fs = useVault(VAULT)
    app.vault.delete = async () => {
      await app.vault.adapter.remove('Notes/Deep/second.md')
    }
    const stop = fs.watch(() => undefined)
    try {
      const listing = fs.list()[Symbol.asyncIterator]()
      expect((await listing.next()).done).toBe(false)
      await app.vault.delete(app.vault.getAbstractFileByPath('Notes') as never)
      const remainder = async () => {
        while (!(await listing.next()).done) {
          /* finish the scan */
        }
      }
      await expect(codeOf(remainder())).resolves.toBe('io')
    } finally {
      stop()
    }
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
    const asked: [string, string][] = []
    let refusals = 0
    app.vault.adapter.rename = async (from: string, to: string) => {
      asked.push([from, to])
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
    // Out from the name that is there either way, and back. The name it goes through is
    // beside the file rather than built on it — a segment may already be at the 255 bytes a
    // filesystem allows — and hidden, so Obsidian's index never sees it.
    const [temp] = asked[1]!.slice(1)
    expect(asked).toEqual([
      ['Note.md', 'note.md'],
      ['note.md', temp],
      [temp, 'note.md'],
    ])
    // `.old`: between the two renames it is the file's only copy, which the write journal
    // puts back after a crash and no sweep ever removes.
    expect(temp).toMatch(/^\.abele-sync-[a-z0-9]{8}\.old$/)
    // Nothing of the adapter's own is left behind in the vault.
    const paths = (await listed(fs)).map((info) => info.path)
    expect(paths.filter((path) => path.includes('abele-sync'))).toEqual([])
  })

  it('leaves a rename that took alone when the listing after it hiccups', async () => {
    const fs = useVault(VAULT)
    const real = app.vault.adapter.list.bind(app.vault.adapter)
    let hiccuped = false
    // The rename works; the one listing that would confirm it does not. Reading that as "the
    // old spelling is still there" would send the rename round again, and the second one has
    // nothing left to move — a conflict held on every sync from then on.
    app.vault.adapter.list = async (path: string) => {
      if (!hiccuped) {
        hiccuped = true
        throw new Error(`EIO: ${path}`)
      }
      return real(path)
    }
    const renamed = app.vault.adapter.rename.bind(app.vault.adapter)
    let renames = 0
    app.vault.adapter.rename = async (from: string, to: string) => {
      renames++
      await renamed(from, to)
    }

    await expect(fs.move('Note.md', 'note.md')).resolves.toBeUndefined()
    expect(hiccuped).toBe(true)
    // One rename, not three: the file was not sent round the temp name after the fact.
    expect(renames).toBe(1)
    expect(await app.vault.adapter.exists('note.md', true)).toBe(true)
    expect(read(await fs.read('note.md'))).toBe('first')
  })

  it('renames a decomposed name into the composed one the server sends back', async () => {
    // What macOS keeps on disk, and what the wire carries: the same name, spelled two ways.
    const decomposed = 'Cafe\u0301.md'
    const composed = 'caf\u00e9.md'
    const fs = useVault([{ path: decomposed, content: 'beans', mtime: 5 }])

    await expect(fs.move(decomposed, composed)).resolves.toBeUndefined()

    expect(await app.vault.adapter.exists(composed, true)).toBe(true)
    expect((await fs.stat(composed))?.path).toBe(composed)
    expect(read(await fs.read(composed))).toBe('beans')
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

  /**
   * A folder another device renamed or emptied stays behind here as an empty tree, and the
   * folder picker goes on offering it. The daemon's rule: only folders that held the file a
   * moment ago, only while they are empty, and never one the person left empty themselves.
   * The fake's `rmdir` is the desktop one, which refuses any folder without `recursive`; the
   * listing is what keeps a folder that holds something.
   */
  it('removes the folders a remove or a move emptied, and no other', async () => {
    const fs = useVault([
      ...VAULT,
      { path: 'Burst/deep/a.md', content: 'a', mtime: 1000, ctime: 900 },
      { path: 'Kept/b.md', content: 'b', mtime: 1000, ctime: 900 },
      { path: 'Kept/c.md', content: 'c', mtime: 1000, ctime: 900 },
      { path: 'Moved/d.md', content: 'd', mtime: 1000, ctime: 900 },
    ])
    await app.vault.adapter.mkdir('Empty')

    await fs.remove('Burst/deep/a.md')
    await fs.remove('Kept/b.md')
    await fs.move('Moved/d.md', 'Elsewhere/d.md')

    expect(await app.vault.adapter.exists('Burst')).toBe(false)
    expect(await app.vault.adapter.exists('Moved')).toBe(false)
    expect(app.vault.getAbstractFileByPath('Burst')).toBeNull()
    expect(await app.vault.adapter.exists('Kept')).toBe(true)
    expect(await app.vault.adapter.exists('Empty')).toBe(true)
    expect(await app.vault.adapter.exists('Elsewhere/d.md')).toBe(true)
  })

  it('leaves an emptied folder that something hidden still holds, and the config folder', async () => {
    const fs = useVault([
      { path: 'Notes/a.md', content: 'a', mtime: 1000, ctime: 900 },
      { path: 'Notes/.DS_Store', content: 'finder', mtime: 1000, ctime: 900 },
      { path: '.obsidian/app.json', content: '{}', mtime: 1000, ctime: 900 },
    ])
    await fs.remove('Notes/a.md')
    await fs.remove('.obsidian/app.json')

    expect(await app.vault.adapter.exists('Notes')).toBe(true)
    expect(await app.vault.adapter.exists('.obsidian')).toBe(true)
  })

  it('leaves the folders alone when a case-only rename keeps the file in them', async () => {
    const fs = useVault([{ path: 'Notes/board.canvas', content: '{}', mtime: 1000, ctime: 900 }])
    await fs.move('Notes/board.canvas', 'Notes/Board.canvas')
    expect(await app.vault.adapter.exists('Notes')).toBe(true)
    expect(await app.vault.adapter.exists('Notes/Board.canvas')).toBe(true)
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

describe('ObsidianFileSystem — telling the host what the engine changed', () => {
  function reporting(specs: FakeFileSpec[]): { fs: ObsidianFileSystem; told: string[] } {
    app = buildFakeVault(specs)
    const told: string[] = []
    const fs = new ObsidianFileSystem(app as unknown as App, {
      pollMs: POLL_MS,
      onEngineWrite: (path) => told.push(path),
    })
    return { fs, told }
  }

  it('names every file written, moved (both names) or removed, once the disk has it', async () => {
    const { fs, told } = reporting(VAULT)

    await fs.writeAtomic('.obsidian/plugins/abele/data.json', text('{"b":3}'), 5000)
    await fs.move('Note.md', 'Moved.md')
    await fs.remove('Notes/Deep/second.md')

    expect(told).toEqual([
      '.obsidian/plugins/abele/data.json',
      'Note.md',
      'Moved.md',
      'Notes/Deep/second.md',
    ])
  })

  it('names nothing for a write the disk refused, or a remove of a file already gone', async () => {
    const { fs, told } = reporting(VAULT)
    app.vault.adapter.writeBinary = async () => {
      throw new Error('ENOSPC: the disk is full')
    }

    await expect(codeOf(fs.writeAtomic('Note.md', text('x'), 1))).resolves.toBe('io')
    await fs.remove('Gone.md')

    expect(told).toEqual([])
  })

  it('writes all the same when the host throws', async () => {
    app = buildFakeVault(VAULT)
    const fs = new ObsidianFileSystem(app as unknown as App, {
      onEngineWrite: () => {
        throw new Error('the host is gone')
      },
    })
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)

    await fs.writeAtomic('Note.md', text('still written'), 1)

    expect(read(await fs.read('Note.md'))).toBe('still written')
    vi.restoreAllMocks()
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
