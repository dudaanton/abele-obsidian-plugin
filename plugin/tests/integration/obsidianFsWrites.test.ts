/**
 * The engine's `writeAtomic` over Obsidian's adapter: the old file or the new one at every
 * instant, never a short one (pi review #1), and folder tidying that never removes a file it
 * did not see (pi review #2).
 *
 * Both of Obsidian's adapters are covered: the phone's, whose `rename` refuses a taken name
 * and is all the fake vault has, and the desktop's, which also holds Node's `fs.promises`
 * (`withDesktopFs`). A crash is a `writeBinary` or `rename` that stops half way and throws.
 */
import { describe, it, expect } from 'vitest'
import { Platform, type App } from 'obsidian'
import { EngineError, type FileInfo } from '@abele/sync-core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { JOURNAL_KEY } from '@/sync/vaultWrites'
import { buildFakeVault, type FakeApp, type FakeFileSpec } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const read = (bytes: Uint8Array | ArrayBuffer): string => new TextDecoder().decode(bytes)

const VAULT: FakeFileSpec[] = [
  { path: 'Note.md', content: 'the whole old note', mtime: 1000, ctime: 900 },
  { path: '.obsidian/plugins/abele/data.json', content: '{"old":true}', mtime: 4000, ctime: 900 },
]

async function listed(fs: ObsidianFileSystem): Promise<FileInfo[]> {
  const out: FileInfo[] = []
  for await (const info of fs.list()) out.push(info)
  return out
}

async function codeOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run
    return 'no error'
  } catch (error) {
    return error instanceof EngineError ? error.code : error
  }
}

/** Every path on the disk, hidden ones included. */
async function everything(app: FakeApp, folder = '/'): Promise<string[]> {
  const out: string[] = []
  const listing = await app.vault.adapter.list(folder)
  out.push(...listing.files)
  for (const child of listing.folders) out.push(...(await everything(app, child)))
  return out.sort()
}

/** A `writeBinary` that dies half way through the next write it is asked for. */
function crashNextWrite(app: FakeApp): void {
  const real = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  let armed = true
  app.vault.adapter.writeBinary = async (path, data, options) => {
    if (!armed) return real(path, data, options)
    armed = false
    await real(path, data.slice(0, Math.floor(data.byteLength / 2)), options)
    throw new Error('the app was closed')
  }
}

for (const platform of ['phone', 'desktop'] as const) {
  describe(`ObsidianFileSystem writes on the ${platform}`, () => {
    function useVault(specs = VAULT): { app: FakeApp; fs: ObsidianFileSystem } {
      const app = buildFakeVault(specs)
      if (platform === 'desktop') withDesktopFs(app)
      return { app, fs: new ObsidianFileSystem(app as unknown as App) }
    }

    it('leaves the whole old note when a write dies half way', async () => {
      const { app, fs } = useVault()
      crashNextWrite(app)
      await expect(
        codeOf(fs.writeAtomic('Note.md', text('the new note, longer'), 9000))
      ).resolves.toBe('io')
      expect(read(await app.vault.adapter.readBinary('Note.md'))).toBe('the whole old note')
      expect((await fs.stat('Note.md'))?.mtime).toBe(1000)
      expect(await everything(app)).toEqual(['.obsidian/plugins/abele/data.json', 'Note.md'])
    })

    it('leaves the whole old data.json when a write dies half way', async () => {
      const { app, fs } = useVault()
      const path = '.obsidian/plugins/abele/data.json'
      crashNextWrite(app)
      await expect(codeOf(fs.writeAtomic(path, text('{"new":"and longer"}'), 9000))).resolves.toBe(
        'io'
      )
      expect(read(await app.vault.adapter.readBinary(path))).toBe('{"old":true}')
      const paths = (await listed(fs)).map((info) => info.path)
      expect(paths.sort()).toEqual([path, 'Note.md'])
    })

    it('leaves no file at all when a new file dies half way', async () => {
      const { app, fs } = useVault()
      crashNextWrite(app)
      await expect(codeOf(fs.writeAtomic('New/fresh.md', text('fresh'), 9000))).resolves.toBe('io')
      expect(await app.vault.adapter.exists('New/fresh.md')).toBe(false)
      expect((await listed(fs)).map((info) => info.path)).not.toContain('New/fresh.md')
    })

    it('replaces a file whole, with its mtime, under the spelling the disk holds', async () => {
      const { app, fs } = useVault()
      await fs.writeAtomic('Note.md', text('second'), 8000)
      expect(read(await fs.read('Note.md'))).toBe('second')
      expect(await fs.stat('Note.md')).toEqual({ path: 'Note.md', size: 6, mtime: 8000 })
      await fs.writeAtomic('.obsidian/plugins/abele/DATA.json', text('{}'), 8100)
      expect(await everything(app)).toEqual(['.obsidian/plugins/abele/data.json', 'Note.md'])
      expect(read(await fs.read('.obsidian/plugins/abele/data.json'))).toBe('{}')
    })

    it.each(['Note.md', '.obsidian/plugins/abele/data.json'])(
      'keeps an edit to existing %s made while the replacement temp is being written',
      async (target) => {
        const { app, fs } = useVault()
        const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
        app.vault.adapter.writeBinary = async (path, bytes, options) => {
          await write(path, bytes, options)
          if (path.endsWith('.tmp'))
            await write(target, text('local edit').buffer as ArrayBuffer, { mtime: 9001 })
        }
        expect(await codeOf(fs.writeAtomic(target, text('remote replacement'), 9000))).toBe(
          'conflict'
        )
        expect(read(await fs.read(target))).toBe('local edit')
        expect((await everything(app)).filter((path) => path.includes('.abele-sync-'))).toEqual([])
      }
    )

    it('does not write over a file somebody made while the new one was being written', async () => {
      const { app, fs } = useVault()
      const real = app.vault.adapter.writeBinary.bind(app.vault.adapter)
      app.vault.adapter.writeBinary = async (path, data, options) => {
        await real(path, data, options)
        if (path.includes('.abele-sync-'))
          await real('Theirs.md', text('mine').buffer as ArrayBuffer)
      }
      await expect(codeOf(fs.writeAtomic('Theirs.md', text('pulled'), 9000))).resolves.toBe(
        'conflict'
      )
      expect(read(await app.vault.adapter.readBinary('Theirs.md'))).toBe('mine')
      expect((await everything(app)).filter((path) => path.includes('abele-sync'))).toEqual([])
    })
  })
}

describe('ObsidianFileSystem writes on the desktop', () => {
  it('preserves an independent edit made at the native rename boundary', async () => {
    const app = buildFakeVault(VAULT)
    // No cooperative adapter queue: preserve the independently written source at the native boundary.
    withDesktopFs(app, { fenced: false })
    const raw = app.vault.adapter as unknown as {
      fsPromises: { rename(from: string, to: string): Promise<void> }
    }
    const rename = raw.fsPromises.rename.bind(raw.fsPromises)
    raw.fsPromises.rename = async (from, to) => {
      await app.vault.adapter.writeBinary(
        'Note.md',
        text('last-instant local edit').buffer as ArrayBuffer,
        { mtime: 9001 }
      )
      await rename(from, to)
    }
    const written: string[] = []
    const fs = new ObsidianFileSystem(app as unknown as App, {
      onEngineWrite: (path) => written.push(path),
    })
    expect(await codeOf(fs.writeAtomic('Note.md', text('remote'), 9000))).toBe('conflict')
    expect(read(await fs.read('Note.md'))).toBe('last-instant local edit')
    expect(written).toEqual([])
  })

  it('serializes a local save queued at replacement rather than dropping its bytes', async () => {
    const app = buildFakeVault(VAULT)
    withDesktopFs(app)
    const raw = app.vault.adapter as unknown as {
      fsPromises: { rename(from: string, to: string): Promise<void> }
    }
    const rename = raw.fsPromises.rename.bind(raw.fsPromises)
    let save: Promise<void> | null = null
    raw.fsPromises.rename = async (from, to) => {
      save = app.vault.adapter.writeBinary(
        'Note.md',
        text('queued local edit').buffer as ArrayBuffer
      )
      await rename(from, to)
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    await fs.writeAtomic('Note.md', text('remote'), 9000)
    await save
    expect(read(await fs.read('Note.md'))).toBe('queued local edit')
  })

  it('never overwrites a local recreation at an unfenced exclusive-install boundary', async () => {
    const app = buildFakeVault(VAULT)
    withDesktopFs(app, { fenced: false })
    const raw = app.vault.adapter as unknown as {
      fsPromises: { link(from: string, to: string): Promise<void> }
    }
    const link = raw.fsPromises.link.bind(raw.fsPromises)
    let once = true
    raw.fsPromises.link = async (from, to) => {
      if (once) {
        once = false
        await app.vault.adapter.writeBinary(
          'Note.md',
          text('recreated locally').buffer as ArrayBuffer
        )
      }
      await link(from, to)
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    expect(await codeOf(fs.writeAtomic('Note.md', text('remote'), 9000))).toBe('io')
    expect(read(await fs.read('Note.md'))).toBe('recreated locally')
    await listed(fs)
    const kept = app.loadLocalStorage('abele-sync-recovered-writes') as { backup: string }[]
    expect(kept).toHaveLength(1)
    expect(read(await app.vault.adapter.readBinary(kept[0]!.backup))).toBe('the whole old note')
  })

  it('does not let another scanner interpret a live unfenced swap gap as deletion', async () => {
    const app = buildFakeVault(VAULT)
    withDesktopFs(app, { fenced: false })
    const raw = app.vault.adapter as unknown as {
      fsPromises: { link(from: string, to: string): Promise<void> }
    }
    const link = raw.fsPromises.link.bind(raw.fsPromises)
    let entered!: () => void, release!: () => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    raw.fsPromises.link = async (from, to) => {
      entered()
      await ready
      await link(from, to)
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    const write = fs.writeAtomic('Note.md', text('remote'), 9000)
    await waiting
    try {
      expect(await app.vault.adapter.exists('Note.md')).toBe(false)
      expect(await codeOf(listed(new ObsidianFileSystem(app as unknown as App)))).toBe('io')
    } finally {
      release()
      await write
    }
    expect(read(await fs.read('Note.md'))).toBe('remote')
  })

  it('replaces the file with one rename over it', async () => {
    const app = buildFakeVault(VAULT)
    const calls = withDesktopFs(app)
    const fs = new ObsidianFileSystem(app as unknown as App)
    await fs.writeAtomic('Note.md', text('second'), 8000)
    expect(calls.renames).toHaveLength(1)
    expect(calls.renames[0]![0]).toMatch(/^\.abele-sync-[a-z0-9]{8}\.tmp$/)
    expect(calls.renames[0]![1]).toBe('Note.md')
  })
})

describe('ObsidianFileSystem writes on a phone, interrupted between the two renames', () => {
  function crashRenameInto(app: FakeApp, target: string): void {
    const real = app.vault.adapter.rename.bind(app.vault.adapter)
    let armed = true
    app.vault.adapter.rename = async (from, to) => {
      if (armed && to === target && from.includes('.abele-sync-')) {
        armed = false
        // The app is gone: nothing after this runs, including putting the old file back.
        app.vault.adapter.rename = async () => {
          throw new Error('the app was closed')
        }
        throw new Error('the app was closed')
      }
      await real(from, to)
    }
  }

  it('puts the old note back at the next listing', async () => {
    const app = buildFakeVault(VAULT)
    const realRename = app.vault.adapter.rename.bind(app.vault.adapter)
    crashRenameInto(app, 'Note.md')
    const fs = new ObsidianFileSystem(app as unknown as App)
    await expect(codeOf(fs.writeAtomic('Note.md', text('new'), 9000))).resolves.toBe('io')
    // Right after the crash: the note is at its backup name, and the journal says so.
    expect(await app.vault.adapter.exists('Note.md')).toBe(false)
    expect(app.loadLocalStorage(JOURNAL_KEY)).not.toBeNull()

    app.vault.adapter.rename = realRename
    const next = new ObsidianFileSystem(app as unknown as App)
    const paths = (await listed(next)).map((info) => info.path)
    expect(paths).toContain('Note.md')
    expect(read(await next.read('Note.md'))).toBe('the whole old note')
    expect(await everything(app)).toEqual(['.obsidian/plugins/abele/data.json', 'Note.md'])
    expect(app.loadLocalStorage(JOURNAL_KEY)).toBeNull()
  })

  it('retries recovery on the same filesystem after a late swap fails and refuses to scan the gap meanwhile', async () => {
    const app = buildFakeVault(VAULT)
    const fs = new ObsidianFileSystem(app as unknown as App)
    await listed(fs)
    const rename = app.vault.adapter.rename.bind(app.vault.adapter)
    const stat = app.vault.adapter.stat.bind(app.vault.adapter)
    crashRenameInto(app, 'Note.md')
    expect(await codeOf(fs.writeAtomic('Note.md', text('remote'), 9000))).toBe('io')
    expect(await codeOf(listed(fs))).toBe('io')
    app.vault.adapter.stat = async (path) => {
      if (path.endsWith('.old')) throw Object.assign(new Error('unavailable'), { code: 'EIO' })
      return stat(path)
    }
    expect(await codeOf(listed(fs))).toBe('io')
    expect(app.loadLocalStorage(JOURNAL_KEY)).not.toBeNull()
    app.vault.adapter.stat = stat
    app.vault.adapter.rename = rename
    expect((await listed(fs)).map((file) => file.path)).toContain('Note.md')
    expect(read(await fs.read('Note.md'))).toBe('the whole old note')
    expect(app.loadLocalStorage(JOURNAL_KEY)).toBeNull()
  })

  it('refuses to scan past an unreadable recovery entry instead of discarding its backup', async () => {
    const backup = '.abele-sync-abcd1234.old'
    const app = buildFakeVault([...VAULT, { path: backup, content: 'only backup', mtime: 1 }])
    app.saveLocalStorage(JOURNAL_KEY, [{ backup }])
    const fs = new ObsidianFileSystem(app as unknown as App)
    expect(await codeOf(listed(fs))).toBe('io')
    expect(read(await app.vault.adapter.readBinary(backup))).toBe('only backup')
  })

  it('does not start a swap if its journal cannot be saved', async () => {
    const app = buildFakeVault(VAULT)
    app.saveLocalStorage = () => {
      throw new Error('storage unavailable')
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    expect(await codeOf(fs.writeAtomic('Note.md', text('remote'), 9000))).toBe('io')
    expect(read(await fs.read('Note.md'))).toBe('the whole old note')
    expect((await everything(app)).filter((path) => path.includes('.abele-sync-'))).toEqual([])
  })

  it('drops the old copy when the new file had already taken the name', async () => {
    const app = buildFakeVault(VAULT)
    const realRemove = app.vault.adapter.remove.bind(app.vault.adapter)
    app.vault.adapter.remove = async (path) => {
      if (path.endsWith('.old')) throw new Error('the app was closed')
      await realRemove(path)
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    await fs.writeAtomic('Note.md', text('new'), 9000)
    app.vault.adapter.remove = realRemove
    // A backup left behind stands beside the finished file; the journal still names it.
    expect((await everything(app)).some((path) => path.endsWith('.old'))).toBe(true)

    const next = new ObsidianFileSystem(app as unknown as App)
    await listed(next)
    expect(read(await next.read('Note.md'))).toBe('new')
    expect(await everything(app)).toEqual(['.obsidian/plugins/abele/data.json', 'Note.md'])
  })

  it('never lists a temp name, and sweeps one left in the config folder', async () => {
    const app = buildFakeVault([
      ...VAULT,
      { path: '.obsidian/plugins/abele/.abele-sync-abcd1234.tmp', content: '{"half', mtime: 1 },
      { path: '.obsidian/.abele-sync-abcd1234.old', content: 'only copy', mtime: 1 },
    ])
    const fs = new ObsidianFileSystem(app as unknown as App)
    const paths = (await listed(fs)).map((info) => info.path)
    expect(paths.filter((path) => path.includes('abele-sync'))).toEqual([])
    const left = await everything(app)
    expect(left).not.toContain('.obsidian/plugins/abele/.abele-sync-abcd1234.tmp')
    // A backup is somebody's only copy of a file: it is never swept, only put back by the journal.
    expect(left).toContain('.obsidian/.abele-sync-abcd1234.old')
  })
})

describe('ObsidianFileSystem tidying folders', () => {
  it('never asks a mobile adapter to prune folders, even if a new file arrives during rmdir', async () => {
    const app = buildFakeVault([...VAULT, { path: 'Inbox/a.md', content: 'a', mtime: 1 }])
    const fs = new ObsidianFileSystem(app as unknown as App)
    const rmdir = app.vault.adapter.rmdir.bind(app.vault.adapter)
    let called = false
    app.vault.adapter.rmdir = async (path, recursive) => {
      called = true
      await app.vault.adapter.writeBinary(`${path}/New.md`, text('new').buffer as ArrayBuffer)
      await rmdir(path, recursive)
    }
    await fs.remove('Inbox/a.md')
    expect(called).toBe(false)
    expect(await app.vault.adapter.exists('Inbox')).toBe(true)
  })
  it('keeps empty folders in mobile mode even when a host exposes native helpers', async () => {
    const app = buildFakeVault([...VAULT, { path: 'Inbox/a.md', content: 'a', mtime: 1 }])
    const calls = withDesktopFs(app)
    const before = Platform.isMobile
    Platform.isMobile = true
    try {
      await new ObsidianFileSystem(app as unknown as App).remove('Inbox/a.md')
      expect(await app.vault.adapter.exists('Inbox')).toBe(true)
      expect(calls.rmdirs).toEqual([])
    } finally {
      Platform.isMobile = before
    }
  })

  it('never removes a file that arrived after the folder was seen empty (desktop)', async () => {
    const app = buildFakeVault([...VAULT, { path: 'Burst/a.md', content: 'a', mtime: 1 }])
    const calls = withDesktopFs(app)
    const fs = new ObsidianFileSystem(app as unknown as App)
    const realList = app.vault.adapter.list.bind(app.vault.adapter)
    app.vault.adapter.list = async (path) => {
      const listing = await realList(path)
      // Obsidian, or the person, puts a file in the folder right after it was looked at.
      if (path === 'Burst')
        await app.vault.adapter.writeBinary('Burst/new.md', text('new').buffer as ArrayBuffer)
      return listing
    }
    await fs.remove('Burst/a.md')
    expect(read(await app.vault.adapter.readBinary('Burst/new.md'))).toBe('new')
    expect(calls.rmdirs).toEqual(['Burst'])
  })

  it('still removes a folder the sync emptied (desktop)', async () => {
    const app = buildFakeVault([...VAULT, { path: 'Burst/deep/a.md', content: 'a', mtime: 1 }])
    withDesktopFs(app)
    const fs = new ObsidianFileSystem(app as unknown as App)
    await fs.remove('Burst/deep/a.md')
    expect(await app.vault.adapter.exists('Burst')).toBe(false)
  })
})
