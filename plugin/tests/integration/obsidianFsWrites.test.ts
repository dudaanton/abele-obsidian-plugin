/**
 * The engine's `writeAtomic` over Obsidian's adapter: the old file or the new one at every
 * instant, never a short one (pi review #1), and folder tidying that never removes a file it
 * did not see (pi review #2).
 *
 * Both of Obsidian's adapters are covered: the phone's, whose `rename` refuses a taken name
 * and is all the fake vault has, and the desktop's, which also holds Node's `fs.promises`
 * (`withDesktopFs`). A crash is a `writeBinary` or `rename` that stops half way and throws.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { Platform, type App } from 'obsidian'
import { constants } from 'node:fs'
import {
  EngineError,
  MemoryStateStore,
  readReconciliation,
  type FileInfo,
} from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { JOURNAL_KEY, WriteJournal } from '@/sync/vaultWrites'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { RuntimeFence } from '@/sync/external/recovery'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { isDeviceLocalPluginState } from '@/sync/deviceLocalState'
import type { ConditionalFileHost } from '@/sync/conditionalFiles'
import { buildFakeVault, type FakeApp, type FakeFileSpec } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const read = (bytes: Uint8Array | ArrayBuffer): string => new TextDecoder().decode(bytes)
afterEach(() => vi.restoreAllMocks())

/** Conditional payloads use the same bounded writer on native and adapter hosts. */
function afterPayloadWrite(work: () => Promise<void>): void {
  const append = BoundedVaultIo.prototype.append
  let armed = true
  vi.spyOn(BoundedVaultIo.prototype, 'append').mockImplementation(async function (...args) {
    await append.apply(this, args)
    if (armed && /\/objects\/[^/]+\/data$/.test(args[0])) {
      armed = false
      await work()
    }
  })
}

it('retains ownership when a failed write cannot remove its private temp', async () => {
  const app = buildFakeVault([])
  const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  const remove = app.vault.adapter.remove.bind(app.vault.adapter)
  let temp = ''
  app.vault.adapter.writeBinary = async (path, bytes, options) => {
    temp = path
    await write(path, bytes, options)
    throw new Error('interrupted write')
  }
  app.vault.adapter.remove = async () => {
    throw new Error('disk unavailable')
  }
  await expect(
    new ObsidianFileSystem(app as never).writeAtomic('sample.bin', text('remote'), 1)
  ).rejects.toThrow()
  expect(app.loadLocalStorage(JOURNAL_KEY)).toEqual([
    expect.objectContaining({ temp, target: 'sample.bin' }),
  ])
  expect(await app.vault.adapter.exists(temp)).toBe(true)
  app.vault.adapter.remove = remove
  await new ObsidianFileSystem(app as never).recover()
  expect(await app.vault.adapter.exists(temp)).toBe(false)
  expect(app.loadLocalStorage(JOURNAL_KEY)).toBeNull()
})

it('never replays or sweeps retired write intents and retains all three physical variants', async () => {
  const target = 'sample.bin',
    temp = '.obsidian/plugins/abele/.abele-sync-abcd1234.tmp',
    backup = '.obsidian/plugins/abele/.abele-sync-abcd1234.old'
  const app = buildFakeVault([
    { path: target, content: 'current local bytes' },
    { path: temp, content: 'pending remote bytes' },
    { path: backup, content: 'previous local bytes' },
  ])
  app.saveLocalStorage(JOURNAL_KEY, [{ target, temp, backup }])
  const fs = new ObsidianFileSystem(app as unknown as App)
  let archive: unknown
  await fs.retireGeneration('new-generation', async (value) => {
    archive = structuredClone(value)
  })
  expect(archive).toEqual([{ target, temp, backup }])
  await fs.recover()
  for await (const _ of fs.list()) {
    /* Exercise the temporary-file sweep too. */
  }
  expect(await app.vault.adapter.read(target)).toBe('current local bytes')
  expect(await app.vault.adapter.read(temp)).toBe('pending remote bytes')
  expect(await app.vault.adapter.read(backup)).toBe('previous local bytes')
  const restarted = new ObsidianFileSystem(app as unknown as App)
  await restarted.recover()
  expect(await app.vault.adapter.read(target)).toBe('current local bytes')
})

it('does not mistake a retained streaming source for destructive startup recovery', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as unknown as App)
  const state = new MemoryStateStore()
  await state.setCursor(1)
  const stage = await fs.beginAtomicWrite('sample.bin', 1000, null)
  await stage.append(0, text('retained bytes'))
  expect(await fs.needsRecoveryHandshake()).toBe(false)
  await fs.fenceRecovery(state, 2)
  expect(await readReconciliation(state)).toBeNull()
  expect((await fs.reopenStage(stage.id)).offset).toBe(14)
})

it.each(['ordinary fingerprint', 'pull after generation retirement'])(
  'rehashes restored bytes even when a mobile write receipt has the same metadata: %s',
  async (mode) => {
    const app = buildFakeVault([])
    const fs = new ObsidianFileSystem(app as unknown as App)
    const stage = await fs.beginAtomicWrite('sample.bin', 1000, null)
    await stage.append(0, text('before'))
    await stage.seal({
      size: 6,
      sha: await import('@abele/sync-sdk/core').then((core) => core.sha256(text('before'))),
    })
    await stage.commit()
    const before = await app.vault.adapter.stat('sample.bin')
    await app.vault.adapter.writeBinary('sample.bin', text('after!').buffer, { mtime: 1000 })
    const stat = app.vault.adapter.stat.bind(app.vault.adapter)
    vi.spyOn(app.vault.adapter, 'stat').mockImplementation((path) =>
      path === 'sample.bin' ? Promise.resolve(before) : stat(path)
    )
    if (mode === 'pull after generation retirement')
      await new ObsidianFileSystem(app as unknown as App).retireGeneration('next', async () => {})
    const identity =
      mode === 'ordinary fingerprint'
        ? await fs.fingerprint('sample.bin')
        : await fs[Symbol.for('abele.sync.fingerprint-pull-v1')]('sample.bin')
    expect(identity.sha).toBe(
      await import('@abele/sync-sdk/core').then((core) => core.sha256(text('after!')))
    )
  }
)

it('stages mobile writes in 1 MiB bridge buffers before installing the complete file', async () => {
  const app = buildFakeVault([]),
    adapter = app.vault.adapter
  const originalWrite = adapter.writeBinary.bind(adapter)
  const write = vi.spyOn(adapter, 'writeBinary')
  const append = vi.fn(async (path: string, bytes: ArrayBuffer) => {
    const old = new Uint8Array(await adapter.readBinary(path))
    const complete = new Uint8Array(old.length + bytes.byteLength)
    complete.set(old)
    complete.set(new Uint8Array(bytes), old.length)
    await originalWrite(path, complete.buffer)
  })
  adapter.appendBinary = append
  const fs = new ObsidianFileSystem(app as unknown as App)
  const digest = vi.spyOn(crypto.subtle, 'digest')
  const bytes = new Uint8Array(3 * 1024 * 1024 + 17).fill(90)
  await fs.writeAtomic('large.bin', bytes, 1000)
  expect(write.mock.calls[0][1].byteLength).toBe(1024 * 1024)
  expect(append.mock.calls.map(([, chunk]) => chunk.byteLength)).toEqual([
    1024 * 1024,
    1024 * 1024,
    17,
  ])
  expect(write.mock.calls[0][2]).toEqual({ mtime: 1000 })
  const installed = new Uint8Array(await adapter.readBinary('large.bin'))
  expect(installed.length).toBe(bytes.length)
  expect(installed.every((value, index) => value === bytes[index])).toBe(true)
  expect((await fs.read('large.bin')).length).toBe(bytes.length)
  expect(digest.mock.calls.some(([, input]) => input.byteLength > 1024 * 1024)).toBe(false)
  digest.mockRestore()
})

it('an interrupted mobile append never installs partial bytes over the original', async () => {
  const app = buildFakeVault([{ path: 'large.bin', content: 'original' }])
  const append = vi.fn(async () => {
    throw new Error('Native append interrupted')
  })
  app.vault.adapter.appendBinary = append
  const fs = new ObsidianFileSystem(app as unknown as App)
  await expect(fs.writeAtomic('large.bin', new Uint8Array(1024 * 1024 + 1), 1000)).rejects.toThrow(
    'cannot write large.bin'
  )
  expect(append).toHaveBeenCalledOnce()
  expect(await app.vault.adapter.read('large.bin')).toBe('original')
})

it('stops mobile staging appends when runtime ownership is lost', async () => {
  const app = buildFakeVault([{ path: 'large.bin', content: 'original' }])
  const fence = new RuntimeFence(app, 'mobile-write-test', () => true)
  fence.activate()
  const originalWrite = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'writeBinary').mockImplementation(async (...args) => {
    await originalWrite(...args)
    fence.release()
  })
  const append = vi.fn(async () => {})
  app.vault.adapter.appendBinary = append
  const fs = new ObsidianFileSystem(app as unknown as App, { runtimeFence: fence })
  await expect(fs.writeAtomic('large.bin', new Uint8Array(1024 * 1024 + 1), 1000)).rejects.toThrow()
  expect(append).not.toHaveBeenCalled()
  expect(await app.vault.adapter.read('large.bin')).toBe('original')
})

it('mobile staging a subarray never copies the whole file view before chunking', async () => {
  const app = buildFakeVault([]),
    cap = 1024 * 1024
  const input = new Uint8Array(3 * cap + 2).subarray(1, -1)
  const write = vi.spyOn(app.vault.adapter, 'writeBinary')
  app.vault.adapter.appendBinary = vi.fn(async () => {})
  const fs = new ObsidianFileSystem(app as unknown as App)
  const slice = vi.spyOn(ArrayBuffer.prototype, 'slice').mockImplementation(function (start, end) {
    const length = (end ?? this.byteLength) - (start ?? 0)
    if (length > cap) throw new Error('whole-file copy')
    return new Uint8Array(this, start, length).slice().buffer
  })
  try {
    await fs.writeAtomic('subarray.bin', input, 1)
    expect(write.mock.calls[0][1].byteLength).toBe(cap)
  } finally {
    slice.mockRestore()
  }
})

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

const CONDITIONAL = '.obsidian/plugins/abele/sync-conditional'
async function ownedInventory(app: FakeApp): Promise<string[]> {
  const paths = await everything(app)
  for (const path of paths.filter((one) =>
    /^.*\/sync-conditional\/(objects|trash)\/[^/]+\/(victim|data)$/.test(one)
  )) {
    const parts = path.split('/'),
      id = parts.at(-2)!
    const pointers = ['active', 'completed', 'review', 'retiring', 'retained']
      .map((area) => `${CONDITIONAL}/${area}/${id}.json`)
      .filter((pointer) => paths.includes(pointer))
    expect(pointers.length, `unowned conditional bytes: ${path}`).toBeGreaterThan(0)
    for (const pointer of pointers)
      expect(JSON.parse(await app.vault.adapter.read(pointer))).toBeTypeOf('object')
  }
  return paths.filter((path) => !isDeviceLocalPluginState(path, app.vault.configDir))
}

/** A `writeBinary` that dies half way through the next write it is asked for. */
function crashNextWrite(app: FakeApp): void {
  const real = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  let armed = true
  app.vault.adapter.writeBinary = async (path, data, options) => {
    // Conditional metadata and empty allocation are preparation, not the payload cut.
    if (!armed || !data.byteLength || !path.includes('/.abele-receipt-'))
      return real(path, data, options)
    armed = false
    await real(path, data.slice(0, Math.floor(data.byteLength / 2)), options)
    throw new Error('the app was closed')
  }
  const append = BoundedVaultIo.prototype.append
  vi.spyOn(BoundedVaultIo.prototype, 'append').mockImplementation(
    async function (path, offset, bytes, mtime, signal) {
      if (!armed || !/\/objects\/[^/]+\/data$/.test(path))
        return append.call(this, path, offset, bytes, mtime, signal)
      armed = false
      await append.call(
        this,
        path,
        offset,
        bytes.slice(0, Math.floor(bytes.length / 2)),
        mtime,
        signal
      )
      throw new Error('the app was closed')
    }
  )
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
      const incoming = text('the new note, longer')
      crashNextWrite(app)
      await expect(codeOf(fs.writeAtomic('Note.md', incoming, 9000))).resolves.toBe('io')
      expect(read(await app.vault.adapter.readBinary('Note.md'))).toBe('the whole old note')
      expect((await fs.stat('Note.md'))?.mtime).toBe(1000)
      expect(await ownedInventory(app)).toEqual(['.obsidian/plugins/abele/data.json', 'Note.md'])
      const partial = (await everything(app)).filter((path) => /\/objects\/[^/]+\/data$/.test(path))
      expect(partial).toHaveLength(1)
      expect(new Uint8Array(await app.vault.adapter.readBinary(partial[0]))).toEqual(
        incoming.slice(0, Math.floor(incoming.length / 2))
      )
      await listed(new ObsidianFileSystem(app as unknown as App))
      expect(await ownedInventory(app)).toEqual(['.obsidian/plugins/abele/data.json', 'Note.md'])
      expect(
        (await everything(app)).filter((path) => /\/objects\/[^/]+\/data$/.test(path))
      ).toEqual(partial)
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
      expect(await fs.stat('Note.md')).toEqual({
        path: 'Note.md',
        size: 6,
        mtime: 8000,
        ctime: expect.any(Number),
      })
      await fs.writeAtomic('.obsidian/plugins/abele/DATA.json', text('{}'), 8100)
      expect(await ownedInventory(app)).toEqual(['.obsidian/plugins/abele/data.json', 'Note.md'])
      expect(read(await fs.read('.obsidian/plugins/abele/data.json'))).toBe('{}')
    })

    it.each(['Note.md', '.obsidian/plugins/abele/data.json'])(
      'keeps an edit to existing %s made while the replacement temp is being written',
      async (target) => {
        const { app, fs } = useVault()
        const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
        afterPayloadWrite(() =>
          write(target, text('local edit').buffer as ArrayBuffer, { mtime: 9001 })
        )
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
        if (path.includes('.abele-sync-') || path.includes('.abele-receipt-'))
          await real('Theirs.md', text('mine').buffer as ArrayBuffer)
      }
      if (platform === 'desktop') {
        const raw = app.vault.adapter as unknown as {
          fsPromises: {
            link(from: string, to: string): Promise<void>
            open(
              path: string,
              flags: number
            ): Promise<{
              write(
                bytes: Uint8Array,
                offset: number,
                length: number,
                position: number
              ): Promise<unknown>
              close(): Promise<void>
            }>
          }
        }
        const link = raw.fsPromises.link.bind(raw.fsPromises)
        raw.fsPromises.link = async (from, to) => {
          if (to.endsWith('/Theirs.md')) {
            // An independent native writer does not join the cooperative save queue.
            const handle = await raw.fsPromises.open(
              to,
              constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
            )
            try {
              await handle.write(text('mine'), 0, 4, 0)
            } finally {
              await handle.close()
            }
          }
          return link(from, to)
        }
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
  it('keeps a scan valid when another connection recovers no conditional effects', async () => {
    const app = buildFakeVault(VAULT)
    withDesktopFs(app)
    const reader = new ObsidianFileSystem(app as unknown as App)
    const other = new ObsidianFileSystem(app as unknown as App)
    const listing = reader.list()[Symbol.asyncIterator]()
    const first = await listing.next()
    expect(first.done).toBe(false)
    await other.recover()
    const paths = [first.value!.path]
    for (;;) {
      const next = await listing.next()
      if (next.done) break
      paths.push(next.value.path)
    }
    expect(paths.sort()).toEqual(['.obsidian/plugins/abele/data.json', 'Note.md'])
  })
  it('keeps a sealed scan intact when a conditional replacement completes between its results', async () => {
    const app = buildFakeVault(VAULT)
    withDesktopFs(app)
    const reader = new ObsidianFileSystem(app as unknown as App)
    const writer = new ObsidianFileSystem(app as unknown as App)
    const listing = reader.list()[Symbol.asyncIterator]()
    const first = await listing.next()
    expect(first.done).toBe(false)
    await writer.writeAtomic('Note.md', text('new complete bytes'), 9000)
    const sealed = [first.value!.path]
    for (;;) {
      const next = await listing.next()
      if (next.done) break
      sealed.push(next.value.path)
    }
    expect(sealed.sort()).toEqual(['.obsidian/plugins/abele/data.json', 'Note.md'])
    expect((await listed(reader)).find((file) => file.path === 'Note.md')?.size).toBe(
      text('new complete bytes').length
    )
    expect(read(await writer.read('Note.md'))).toBe('new complete bytes')
  })
  it('preserves an independent edit made at the native rename boundary', async () => {
    const app = buildFakeVault(VAULT)
    // No cooperative adapter queue: preserve the independently written source at the native boundary.
    withDesktopFs(app, { fenced: false })
    const raw = app.vault.adapter as unknown as {
      fsPromises: { rename(from: string, to: string): Promise<void> }
    }
    const rename = raw.fsPromises.rename.bind(raw.fsPromises)
    raw.fsPromises.rename = async (from, to) => {
      if (!from.endsWith('/Note.md') || !to.endsWith('/victim')) return rename(from, to)
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
    // Restoring the captured edit must invalidate its index entry exactly once.
    expect(written).toEqual(['Note.md'])
    expect((await ownedInventory(app)).filter((path) => path !== 'Note.md')).toEqual([
      '.obsidian/plugins/abele/data.json',
    ])
  })

  it('serializes a local save queued at replacement rather than dropping its bytes', async () => {
    const app = buildFakeVault(VAULT)
    withDesktopFs(app)
    const raw = app.vault.adapter as unknown as {
      fsPromises: { link(from: string, to: string): Promise<void> }
    }
    const link = raw.fsPromises.link.bind(raw.fsPromises)
    let save: Promise<void> | null = null
    raw.fsPromises.link = async (from, to) => {
      if (to.endsWith('/Note.md'))
        save = app.vault.adapter.writeBinary(
          'Note.md',
          text('queued local edit').buffer as ArrayBuffer
        )
      await link(from, to)
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
      if (once && to.endsWith('/Note.md')) {
        once = false
        await app.vault.adapter.writeBinary(
          'Note.md',
          text('recreated locally').buffer as ArrayBuffer
        )
      }
      await link(from, to)
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    expect(await codeOf(fs.writeAtomic('Note.md', text('remote'), 9000))).toBe('conflict')
    expect(read(await fs.read('Note.md'))).toBe('recreated locally')
    await listed(fs)
    await ownedInventory(app)
    const retained = (await everything(app)).filter((path) => path.endsWith('/victim'))
    expect(retained).toHaveLength(1)
    expect(read(await app.vault.adapter.readBinary(retained[0]))).toBe('the whole old note')
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
      if (!to.endsWith('/Note.md')) return link(from, to)
      entered()
      await ready
      await link(from, to)
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    const write = fs.writeAtomic('Note.md', text('remote'), 9000)
    await waiting
    try {
      expect(await app.vault.adapter.exists('Note.md')).toBe(false)
      let settled = false
      const scan = listed(new ObsidianFileSystem(app as unknown as App)).then(
        (files) => {
          settled = true
          return files
        },
        (error: unknown) => {
          settled = true
          throw error
        }
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(settled).toBe(false)
      release()
      await write
      expect((await scan).map((file) => file.path)).toContain('Note.md')
    } finally {
      release()
      await write
    }
    expect(read(await fs.read('Note.md'))).toBe('remote')
  })

  it('retries a live backup after releasing recovery coordination for a queued edit', async () => {
    const backup = '.obsidian/plugins/abele/sync-staging/.abele-sync-abcd1234.old'
    const app = buildFakeVault([...VAULT, { path: backup, content: 'retained old bytes' }])
    withDesktopFs(app, { fenced: false })
    app.saveLocalStorage(JOURNAL_KEY, [{ target: 'Note.md', backup }])
    const disk = new ObsidianFileSystem(app as unknown as App)
    const writer = Reflect.get(disk, 'writer') as {
      holding<T>(path: string, run: () => Promise<T>): Promise<T>
      recover(...args: unknown[]): Promise<void>
    }
    let entered!: () => void
    const recovering = new Promise<void>((resolve) => (entered = resolve))
    const recover = writer.recover.bind(writer)
    writer.recover = async (...args) => {
      entered()
      return recover(...args)
    }
    let proceed!: () => void
    const queued = new Promise<void>((resolve) => (proceed = resolve))
    const held = writer.holding(backup, async () => {
      await queued
      await pathCoordinatorOf(app.vault).run(['Note.md'], async () => {
        await app.vault.adapter.writeBinary('Note.md', text('local edit').buffer as ArrayBuffer)
      })
    })
    const scan = listed(disk).then(
      () => 'settled',
      (error: unknown) => error
    )
    await recovering
    proceed()
    const outcome = await Promise.race([
      scan,
      new Promise((resolve) => setTimeout(() => resolve('deadlocked'), 1000)),
    ])
    expect(outcome).toBe('settled')
    await held
    expect(read(await disk.read('Note.md'))).toBe('local edit')
    // Recovery now completes the durable private archive, rather than leaving
    // the old staging locator unfinished and blocking the next enrollment.
    const recovered = await new WriteJournal(app).currentRecovered()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({ target: 'Note.md', archived: true })
    expect(await app.vault.adapter.exists(backup)).toBe(false)
    expect(await app.vault.adapter.read(recovered[0].backup)).toBe('retained old bytes')
  })

  it('publishes the complete file once after retaining the displaced inode', async () => {
    const app = buildFakeVault(VAULT)
    const calls = withDesktopFs(app)
    const raw = app.vault.adapter as unknown as {
      fsPromises: { link(from: string, to: string): Promise<void> }
    }
    const link = raw.fsPromises.link.bind(raw.fsPromises)
    const publications: string[] = []
    raw.fsPromises.link = async (from, to) => {
      if (to.endsWith('/Note.md')) publications.push(from)
      return link(from, to)
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    await fs.writeAtomic('Note.md', text('second'), 8000)
    expect(calls.renames.filter(([from]) => from === 'Note.md')).toHaveLength(1)
    expect(calls.renames.some(([, to]) => to === 'Note.md')).toBe(false)
    expect(publications).toHaveLength(1)
    expect(publications[0]).toMatch(/\/objects\/[^/]+\/data$/)
    expect(read(await fs.read('Note.md'))).toBe('second')
    await ownedInventory(app)
  })
})

describe('ObsidianFileSystem writes on a phone, interrupted between the two renames', () => {
  function crashRenameInto(fs: ObsidianFileSystem, target: string): () => void {
    const host = Reflect.get(Reflect.get(fs, 'conditional'), 'host') as ConditionalFileHost
    let dead = false,
      armed = true
    const check = () => {
      if (dead) throw new EngineError('io', 'the app was closed')
    }
    const wrap = (port: ConditionalFileHost): ConditionalFileHost => {
      const { check: ready, stat, capture, install } = port
      return {
        ...port,
        check: () => {
          check()
          ready()
        },
        stat: (path) => {
          check()
          return stat(path)
        },
        capture: (from, to) => {
          check()
          return capture(from, to)
        },
        install: (from, to) => {
          check()
          if (armed && to === target && /\/objects\/[^/]+\/data$/.test(from)) {
            armed = false
            dead = true
            throw new Error('the app was closed')
          }
          return install(from, to)
        },
      }
    }
    const leased = host.withMutationCheck!.bind(host)
    Object.assign(host, wrap(host))
    host.withMutationCheck = (current) => wrap(leased(current))
    return () => {
      dead = false
    }
  }
  const pending = async (app: FakeApp) =>
    (await app.vault.adapter.list(CONDITIONAL + '/active')).files

  it('puts the old note back at the next listing', async () => {
    const app = buildFakeVault(VAULT)
    const fs = new ObsidianFileSystem(app as unknown as App)
    crashRenameInto(fs, 'Note.md')
    await expect(codeOf(fs.writeAtomic('Note.md', text('new'), 9000))).resolves.toBe('io')
    // Right after the crash: the note is at its backup name, and the journal says so.
    expect(await app.vault.adapter.exists('Note.md')).toBe(false)
    expect(await pending(app)).toHaveLength(1)

    const next = new ObsidianFileSystem(app as unknown as App)
    const paths = (await listed(next)).map((info) => info.path)
    expect(paths).toContain('Note.md')
    expect(read(await next.read('Note.md'))).toBe('the whole old note')
    const recovered = (await ownedInventory(app)).filter(
      (path) => path !== '.obsidian/plugins/abele/data.json' && path !== 'Note.md'
    )
    expect(recovered).toHaveLength(1)
    expect(read(await next.read(recovered[0]))).toBe('new')
    await listed(next)
    expect(await ownedInventory(app)).toEqual(paths.sort())
    expect(await pending(app)).toHaveLength(0)
    expect(app.loadLocalStorage(JOURNAL_KEY)).toBeNull()
  })

  it('retries recovery on the same filesystem after a late swap fails and refuses to scan the gap meanwhile', async () => {
    const app = buildFakeVault(VAULT)
    const fs = new ObsidianFileSystem(app as unknown as App)
    await listed(fs)
    const resume = crashRenameInto(fs, 'Note.md')
    expect(await codeOf(fs.writeAtomic('Note.md', text('remote'), 9000))).toBe('io')
    expect(await codeOf(listed(fs))).toBe('io')
    resume()
    const host = Reflect.get(Reflect.get(fs, 'conditional'), 'host') as ConditionalFileHost
    const stat = host.stat
    host.stat = async (path) => {
      if (path.endsWith('/victim')) throw Object.assign(new Error('unavailable'), { code: 'EIO' })
      return stat(path)
    }
    expect(await codeOf(listed(fs))).toBe('io')
    expect(await pending(app)).toHaveLength(1)
    host.stat = stat
    expect((await listed(fs)).map((file) => file.path)).toContain('Note.md')
    expect(read(await fs.read('Note.md'))).toBe('the whole old note')
    await ownedInventory(app)
    expect(await pending(app)).toHaveLength(0)
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
    const append = BoundedVaultIo.prototype.append
    vi.spyOn(BoundedVaultIo.prototype, 'append').mockImplementation(function (...args) {
      if (args[0].endsWith('/intent.json')) throw new Error('storage unavailable')
      return append.apply(this, args)
    })
    const fs = new ObsidianFileSystem(app as unknown as App)
    expect(await codeOf(fs.writeAtomic('Note.md', text('remote'), 9000))).toBe('io')
    expect(read(await fs.read('Note.md'))).toBe('the whole old note')
    expect((await everything(app)).filter((path) => path.includes('.abele-sync-'))).toEqual([])
  })

  it('retires interrupted conditional metadata after publication while retaining the old bytes', async () => {
    const app = buildFakeVault(VAULT)
    const realRemove = app.vault.adapter.remove.bind(app.vault.adapter)
    let crashed = true
    app.vault.adapter.remove = async (path) => {
      if (crashed && /\/objects\/[^/]+\/intent.json$/.test(path))
        throw new Error('the app was closed')
      await realRemove(path)
    }
    const fs = new ObsidianFileSystem(app as unknown as App)
    expect(await codeOf(fs.writeAtomic('Note.md', text('new'), 9000))).toBe('io')
    crashed = false
    app.vault.adapter.remove = realRemove
    const victims = (await everything(app)).filter((path) => path.endsWith('/victim'))
    expect(victims).toHaveLength(1)
    expect(await app.vault.adapter.read(victims[0])).toBe('the whole old note')

    const next = new ObsidianFileSystem(app as unknown as App)
    await listed(next)
    expect(read(await next.read('Note.md'))).toBe('new')
    expect(await ownedInventory(app)).toEqual(['.obsidian/plugins/abele/data.json', 'Note.md'])
    expect((await everything(app)).filter((path) => path.endsWith('/victim'))).toEqual(victims)
    await listed(next)
    expect((await everything(app)).filter((path) => path.endsWith('/victim'))).toEqual(victims)
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
      if (path !== 'Inbox') return rmdir(path, recursive)
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
      expect(calls.rmdirs.filter((path) => path === 'Inbox')).toEqual([])
    } finally {
      Platform.isMobile = before
    }
  })

  it('never removes a file that arrived after the folder was seen empty (desktop)', async () => {
    const app = buildFakeVault([...VAULT, { path: 'Burst/a.md', content: 'a', mtime: 1 }])
    const calls = withDesktopFs(app)
    const fs = new ObsidianFileSystem(app as unknown as App)
    const raw = app.vault.adapter as unknown as {
      fsPromises: { rmdir(path: string): Promise<void> }
    }
    const rmdir = raw.fsPromises.rmdir.bind(raw.fsPromises)
    raw.fsPromises.rmdir = async (path) => {
      // A native empty-only removal must refuse a note arriving at its syscall boundary.
      if (path.endsWith('/Burst'))
        await app.vault.adapter.writeBinary('Burst/new.md', text('new').buffer as ArrayBuffer)
      return rmdir(path)
    }
    await fs.remove('Burst/a.md')
    expect(read(await app.vault.adapter.readBinary('Burst/new.md'))).toBe('new')
    expect(calls.rmdirs.filter((path) => path === 'Burst')).toEqual(['Burst'])
  })

  it('still removes a folder the sync emptied (desktop)', async () => {
    const app = buildFakeVault([...VAULT, { path: 'Burst/deep/a.md', content: 'a', mtime: 1 }])
    withDesktopFs(app)
    const fs = new ObsidianFileSystem(app as unknown as App)
    await fs.remove('Burst/deep/a.md')
    expect(await app.vault.adapter.exists('Burst')).toBe(false)
  })
})
