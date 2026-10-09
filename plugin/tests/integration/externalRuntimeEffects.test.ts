import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@abele/sync-core'
import { JOURNAL_KEY } from '@/sync/writeJournal'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { RuntimeFence } from '@/sync/external/recovery'
import { nativeOf } from '@/sync/nativeVaultFs'
import { useVault } from '../helpers/testEnv'

const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) fn()
})
it.each(['write', 'move', 'remove'] as const)(
  'refuses a public filesystem %s until startup recovery activates its fence',
  async (verb) => {
    const app = useVault([{ path: 'Media/sample.bin', content: 'sample original' }])
    const fence = new RuntimeFence(app, 'sample-runtime', () => true)
    cleanup.push(() => fence.release())
    const fs = new ObsidianFileSystem(app as never, { runtimeFence: fence })
    const work =
      verb === 'write'
        ? fs.writeAtomic('Media/sample.bin', new TextEncoder().encode('new bytes'), 1000)
        : verb === 'move'
          ? fs.move('Media/sample.bin', 'Media/other.bin')
          : fs.remove('Media/sample.bin')
    await expect(work).rejects.toThrow(/recovery|external/i)
    expect(await app.vault.adapter.read('Media/sample.bin')).toBe('sample original')
  }
)
it('does not install a staged new file after losing ownership during its temp write', async () => {
  const app = useVault([]),
    fence = new RuntimeFence(app, 'sample-writer', () => true)
  cleanup.push(() => fence.release())
  fence.activate()
  const fs = new ObsidianFileSystem(app as never, { runtimeFence: fence })
  const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'writeBinary').mockImplementation(async (...args) => {
    await write(...args)
    fence.release()
  })
  const rename = vi.spyOn(app.vault.adapter, 'rename')
  await expect(
    fs.writeAtomic('sample.bin', new TextEncoder().encode('sample incoming'), 1000)
  ).rejects.toThrow()
  expect(rename).not.toHaveBeenCalled()
  expect(await app.vault.adapter.exists('sample.bin')).toBe(false)
})

it('does not install or restore through the mobile swap after losing ownership while reading its backup', async () => {
  const app = useVault([{ path: 'sample.bin', content: 'sample original' }]),
    fence = new RuntimeFence(app, 'sample-writer', () => true)
  cleanup.push(() => fence.release())
  fence.activate()
  const fs = new ObsidianFileSystem(app as never, { runtimeFence: fence })
  const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
  let backup = ''
  vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
    const bytes = await read(path)
    if (path.endsWith('.old')) {
      backup = path
      fence.release()
    }
    return bytes
  })
  const rename = vi.spyOn(app.vault.adapter, 'rename')
  await expect(
    fs.writeAtomic('sample.bin', new TextEncoder().encode('sample incoming'), 1000)
  ).rejects.toThrow()
  expect(rename.mock.calls).toEqual([['sample.bin', backup]])
  expect(await app.vault.adapter.read(backup)).toBe('sample original')
  expect(app.loadLocalStorage(JOURNAL_KEY)).not.toBeNull()
})

it.each(['cleanup', 'restore'] as const)(
  'does not perform journal recovery %s after an awaited ownership loss',
  async (kind) => {
    const target = 'sample.bin',
      backup = '.abele-sync-abcd1234.old'
    const app = useVault([
      { path: backup, content: 'sample original' },
      ...(kind === 'cleanup' ? [{ path: target, content: 'sample incoming' }] : []),
    ])
    const fence = new RuntimeFence(app, 'sample-writer', () => true)
    cleanup.push(() => fence.release())
    const signature = await sha256(new TextEncoder().encode('sample incoming'))
    app.saveLocalStorage(JOURNAL_KEY, [{ target, backup, replacementSha: signature }])
    const fs = new ObsidianFileSystem(app as never, { runtimeFence: fence })
    if (kind === 'cleanup') {
      const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
      vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
        const bytes = await read(path)
        fence.release()
        return bytes
      })
    } else {
      const stat = app.vault.adapter.stat.bind(app.vault.adapter)
      vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
        const found = await stat(path)
        if (path === target) fence.release()
        return found
      })
    }
    const remove = vi.spyOn(app.vault.adapter, 'remove'),
      rename = vi.spyOn(app.vault.adapter, 'rename')
    await expect(fs.recover()).rejects.toThrow()
    expect(remove).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
    expect(await app.vault.adapter.read(backup)).toBe('sample original')
    expect(app.loadLocalStorage(JOURNAL_KEY)).not.toBeNull()
  }
)

it('rejects a lost claim during IndexedDB schema initialization without leaving an unowned database', async () => {
  const factory = new IDBFactory()
  let checks = 0
  await expect(
    IndexedDbStateStore.open(factory, 'sample-guarded-open', {
      effectGuard: () => {
        if (++checks > 1) throw new Error('sample lost initialization claim')
      },
    })
  ).rejects.toThrow(/initialization claim|open/)
  expect(await factory.databases()).toEqual([])
})

it('rejects an old overlay at flush rather than committing it after a successor claim', async () => {
  const app = useVault([]),
    store = await IndexedDbStateStore.open(new IDBFactory(), 'sample-runtime')
  cleanup.push(() => store.close())
  const previous = new RuntimeFence(app, 'sample-runtime', () => true)
  store.guardEffects(() => previous.assertOwned())
  let proceed = () => {},
    staged = () => {}
  const waiting = new Promise<void>((resolve) => {
    proceed = resolve
  })
  const entered = new Promise<void>((resolve) => {
    staged = resolve
  })
  const transaction = store.transaction(async () => {
    await store.setMeta('sample-pending', 'uncommitted')
    staged()
    await waiting
  })
  await entered
  const next = new RuntimeFence(app, 'sample-runtime', () => true)
  cleanup.push(() => next.release())
  proceed()
  await expect(transaction).rejects.toThrow(/ownership|held/i)
  expect(await store.getMeta('sample-pending')).toBeNull()
})
it('rechecks native ownership inside the save queue after the final byte read', async () => {
  const app = useVault([]),
    fence = new RuntimeFence(app, 'sample-runtime', () => true)
  cleanup.push(() => fence.release())
  const rename = vi.fn(),
    bytes = new TextEncoder().encode('sample original')
  const adapter = {
    getFullPath: (path: string) => path,
    queue: async (fn: () => Promise<void>) => fn(),
    fsPromises: {
      rename,
      rmdir: vi.fn(),
      readFile: async () => {
        fence.release()
        return bytes
      },
    },
  }
  const native = nativeOf(adapter as never, () => fence.assertOwned())!
  await expect(native.replaceFenced!('sample.tmp', 'sample.bin', bytes.buffer)).rejects.toThrow(
    /ownership|held/i
  )
  expect(rename).not.toHaveBeenCalled()
})
it('settles already-issued predecessor effects before a successor can activate', async () => {
  const app = useVault([]),
    previous = new RuntimeFence(app, 'sample-runtime', () => true)
  let finish = () => {}
  const effect = previous.effect(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const next = new RuntimeFence(app, 'sample-runtime', () => true)
  cleanup.push(() => next.release())
  let activated = false
  const recovery = next.settlePredecessors().then(() => {
    next.activate()
    activated = true
  })
  await Promise.resolve()
  expect(activated).toBe(false)
  finish()
  await effect
  await recovery
  expect(activated).toBe(true)
  expect(() => previous.assertOwned()).toThrow(/ownership|held/i)
})
