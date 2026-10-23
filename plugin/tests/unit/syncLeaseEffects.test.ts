import { constants } from 'node:fs'
import { desktopFsPort } from '../helpers/desktopRequire'
import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { checkedVaultPort } from '@/sync/vaultPathLinks'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'
import { RuntimeFence } from '@/sync/external/recovery'
import { virtualNativeVault } from '../helpers/virtualNativeVault'
import {
  guardedVaultAdapter,
  mutationCheckedAdapter,
  connectionAdapter,
} from '@/sync/vaultPathLinks'

type Path = 'recovery' | 'publish' | 'rename' | 'remove'
const payload = new TextEncoder().encode('incoming')
const mutates =
  /^(?:write.*|append.*|process|mkdir|rename|copy.*|remove|rmdir|trash.*|unlink|link|truncate|utimes|sync|datasync)$/

it.each([false, true])(
  'tracks submitted leased effects until acknowledgement (native=%s)',
  async (native) => {
    vi.useFakeTimers()
    const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fixture = native ? virtualNativeVault() : undefined
    const app = fixture?.app ?? buildFakeVault([])
    if (fixture) desktopFsPort(fixture.native)
    await app.vault.adapter.writeBinary('sample.bin', payload.buffer)
    const entered = deferred(),
      resume = deferred()
    const target = fixture?.native ?? app.vault.adapter
    const rename = target.rename
    target.rename = async (...args: [string, string]) => {
      await rename.apply(target, args)
      entered.resolve()
      await resume.promise
    }
    const values = new Map<string, unknown>()
    const fence = new RuntimeFence(
      {
        loadLocalStorage: (key) => values.get(key) ?? null,
        saveLocalStorage: (key, value) => {
          values.set(key, value)
        },
      },
      'sample-lease-effects',
      () => true
    )
    fence.activate()
    const disk = new ObsidianFileSystem(app as never, { runtimeFence: fence })
    const port = checkedVaultPort(app.vault as never, app.vault.adapter as never, {
      ready() {},
      effect: (work) => work(),
    })
    const lease = await port.acquire(['sample.bin', 'moved.bin'])
    const host = Reflect.get(Reflect.get(disk, 'conditional'), 'host').withMutationCheck(() =>
      lease.check()
    )
    const work = host.capture('sample.bin', 'moved.bin') as Promise<void>
    const result = lease.wait(work).catch((error: unknown) => error)
    try {
      await vi.advanceTimersByTimeAsync(0)
      await entered.promise
      let drained = false
      const draining = fence.settlePredecessors().then(() => {
        drained = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(drained).toBe(false)
      await vi.advanceTimersByTimeAsync(2000)
      expect(await result).toMatchObject({ leaseExpired: true })
      expect(drained).toBe(false)
      resume.resolve()
      await work
      await draining
      expect(drained).toBe(true)
    } finally {
      resume.resolve()
      lease()
      fence.release()
      loud.mockRestore()
      vi.useRealTimers()
    }
  }
)

async function runCut(native: boolean, path: Path, cut?: number) {
  const fixture = native ? virtualNativeVault() : undefined
  const app = fixture?.app ?? buildFakeVault([])
  if (fixture) desktopFsPort(fixture.native)
  await app.vault.adapter.mkdir('scope')
  await app.vault.adapter.mkdir('.abele-sync')
  await app.vault.adapter.writeBinary('scope/sample.bin', new TextEncoder().encode('local').buffer)
  await app.vault.adapter.writeBinary('.abele-sync/incoming.tmp', payload.buffer)
  const entered = deferred(),
    resume = deferred()
  const trace: string[] = [],
    effects: string[] = []
  let watching = false
  const instrument = (target: object, label: string) => {
    for (const key of Object.keys(target)) {
      const original = Reflect.get(target, key)
      if (typeof original !== 'function' || ['getFullPath', 'getName', 'getBasePath'].includes(key))
        continue
      Reflect.set(target, key, async (...args: unknown[]) => {
        const ordinal = watching ? trace.push(label + '.' + key) - 1 : -1
        const opensForWrite =
          key === 'open' &&
          (typeof args[1] === 'number'
            ? !!(
                args[1] &
                (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC)
              )
            : /[wa+]/.test(String(args[1])))
        if (watching && (mutates.test(key) || opensForWrite)) effects.push(label + '.' + key)
        let answer: unknown,
          failure: unknown,
          failed = false
        try {
          answer = await original.apply(target, args)
        } catch (error) {
          failed = true
          failure = error
        }
        if (key === 'open' && answer && typeof answer === 'object') instrument(answer, 'handle')
        if (ordinal === cut) {
          entered.resolve()
          await resume.promise
        }
        if (failed) throw failure
        return answer
      })
    }
  }
  instrument(app.vault.adapter, 'adapter')
  if (fixture) instrument(fixture.native, 'native')
  // Exercise connection scope reconstruction as well as the inner vault guard.
  const scoped = connectionAdapter(app.vault.adapter as never, 'scope', '.abele-sync')
  const disk = new ObsidianFileSystem(app as never, {
    adapter: scoped,
    connectionId: 'sample-lease',
  })
  const port = checkedVaultPort(app.vault as never, scoped, {
    ready() {},
    effect: (work) => work(),
  })
  const lease = await port.acquire(['scope/sample.bin', 'scope/published.bin', 'scope/moved.bin'])
  const checked = guardedVaultAdapter(mutationCheckedAdapter(scoped, () => lease.check()))
  watching = true
  const work =
    path === 'recovery'
      ? (Reflect.get(disk, 'conditional').recoverIncoming(
          '.abele-sync/incoming.tmp',
          'scope/sample.bin',
          lease
        ) as Promise<void>)
      : path === 'publish'
        ? checked.rename('.abele-sync/incoming.tmp', 'scope/published.bin')
        : path === 'rename'
          ? checked.rename('scope/sample.bin', 'scope/moved.bin')
          : checked.remove('scope/sample.bin')
  const underlying = work.then(
    () => undefined,
    () => undefined
  )
  const result = lease.wait(work).then(
    () => 'done',
    (error: unknown) => error
  )
  try {
    await vi.advanceTimersByTimeAsync(0)
    if (cut === undefined) {
      expect(await result).toBe('done')
      expect(trace.length).toBeGreaterThan(0)
      expect(effects.length).toBeGreaterThan(0)
    } else {
      await entered.promise
      await vi.advanceTimersByTimeAsync(2000)
      expect(await result).toMatchObject({ leaseExpired: true })
      const before = [...effects]
      resume.resolve()
      await vi.advanceTimersByTimeAsync(0)
      await underlying
      if (path === 'recovery') {
        // Recovery now deliberately starts a fresh repair after the expired call
        // settles. The invariant is byte preservation, not suppression of repair.
        await Promise.all(Reflect.get(Reflect.get(disk, 'conditional'), 'lateRepairs') ?? [])
        expect([...new Uint8Array(await app.vault.adapter.readBinary('scope/sample.bin'))]).toEqual(
          [...new TextEncoder().encode('local')]
        )
        const filesIn = async (folder: string): Promise<string[]> => {
          const entries = await app.vault.adapter.list(folder)
          return [...entries.files, ...(await Promise.all(entries.folders.map(filesIn))).flat()]
        }
        const files = await filesIn('')
        const contents = await Promise.all(
          files.map(async (file) => [...new Uint8Array(await app.vault.adapter.readBinary(file))])
        )
        expect(contents, `incoming bytes after ${cut}: ${trace[cut]}`).toContainEqual([...payload])
      } else {
        expect(effects, `late effects after ${cut}: ${trace[cut]}`).toEqual(before)
      }
    }
    return trace
  } finally {
    watching = false
    resume.resolve()
    lease()
  }
}

const cases = [false, true].flatMap((native) =>
  (['recovery', 'publish', 'rename', 'remove'] as const).flatMap((path) => {
    const shards = native && path === 'recovery' ? 16 : 1
    return Array.from({ length: shards }, (_, shard) => ({ native, path, shard, shards }))
  })
)
it.each(cases)(
  'preserves bytes across every adapter continuation (native=$native, path=$path, shard=$shard)',
  async ({ native, path, shard, shards }) => {
    vi.useFakeTimers()
    const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const baseline = await runCut(native, path)
      let checked = 0
      for (let cut = shard; cut < baseline.length; cut += shards) {
        await runCut(native, path, cut)
        checked++
      }
      expect(checked).toBeGreaterThan(0)
      console.debug('[lease boundary matrix]', {
        native,
        path,
        shard,
        boundaries: baseline.length,
        checked,
      })
    } finally {
      loud.mockRestore()
      vi.useRealTimers()
    }
  }
)

it('does not issue recovery mkdir after a pending existence read outlives the lease', async () => {
  vi.useFakeTimers()
  const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
  const entered = deferred(),
    resume = deferred()
  const app = buildFakeVault([{ path: 'sample.bin', content: 'local' }])
  await app.vault.adapter.writeBinary('incoming.tmp', new TextEncoder().encode('incoming').buffer)
  const exists = app.vault.adapter.exists
  app.vault.adapter.exists = async (...args) => {
    const answer = await exists(...args)
    if (args[0].includes('/objects/') && !answer) {
      entered.resolve()
      await resume.promise
    }
    return answer
  }
  const mkdir = vi.spyOn(app.vault.adapter, 'mkdir')
  const port = checkedVaultPort(app.vault as never, app.vault.adapter as never, {
    ready() {},
    effect: (work) => work(),
  })
  const disk = new ObsidianFileSystem(app as never)
  const lease = await port.acquire(['sample.bin'])
  const recovery = Reflect.get(disk, 'conditional').recoverIncoming(
    'incoming.tmp',
    'sample.bin',
    lease
  )
  const settled = recovery.catch((error: unknown) => error)
  try {
    await vi.advanceTimersByTimeAsync(0)
    await entered.promise
    const before = mkdir.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(await settled).toMatchObject({ leaseExpired: true })
    resume.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(mkdir).toHaveBeenCalledTimes(before)
    expect(await app.vault.adapter.read('sample.bin')).toBe('local')
    expect(await app.vault.adapter.read('incoming.tmp')).toBe('incoming')
  } finally {
    resume.resolve()
    lease()
    loud.mockRestore()
    vi.useRealTimers()
  }
})

// BUG D-163: raw overwrite/unlink and unjournalled capture have no repair evidence.
;[false, true]
  .flatMap((native) =>
    (['rename', 'write', 'remove', 'mkdir', 'publish'] as const).map((operation) => ({
      native,
      operation,
    }))
  )
  .forEach(({ native, operation }) => {
    const test = ['rename', 'write', 'remove'].includes(operation) ? it.fails : it
    test(`preserves user bytes after a late ${operation} (native=${native})`, async () => {
      vi.useFakeTimers()
      const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
      const fixture = native ? virtualNativeVault() : undefined
      const app = fixture?.app ?? buildFakeVault([])
      if (fixture) desktopFsPort(fixture.native)
      const adapter = app.vault.adapter
      const initial = new TextEncoder().encode('before').buffer
      const saved = new TextEncoder().encode('user save after expiry').buffer
      await adapter.writeBinary('sample.bin', initial)
      await adapter.writeBinary('incoming.tmp', payload.buffer)
      const entered = deferred(),
        resume = deferred()
      const target = fixture?.native ?? adapter
      const method = native
        ? { rename: 'rename', write: 'open', remove: 'unlink', mkdir: 'mkdir', publish: 'link' }[
            operation
          ]
        : {
            rename: 'rename',
            write: 'writeBinary',
            remove: 'remove',
            mkdir: 'mkdir',
            publish: 'rename',
          }[operation]
      const original = Reflect.get(target, method) as (...args: unknown[]) => Promise<unknown>
      let first = true,
        lateSubmissions = 0
      // Installed BEFORE our gate, retaining the original receiver and callable in a closure.
      Reflect.set(target, method, async (...args: unknown[]) => {
        if (first) {
          first = false
          entered.resolve()
          await resume.promise
          lateSubmissions++
        }
        return original.apply(target, args)
      })
      const port = checkedVaultPort(app.vault as never, adapter as never, {
        ready() {},
        effect: (work) => work(),
      })
      const lease = await port.acquire(['sample.bin', 'incoming.tmp', 'moved.bin', 'new-folder'])
      const checked = mutationCheckedAdapter(adapter as never, () => lease.check())
      const nativePort = Reflect.get(checked, 'fsPromises')
      const invoke = () => {
        if (native) {
          const full = (name: string) => 'sample-vault/' + name
          if (operation === 'rename')
            return nativePort.rename(full('sample.bin'), full('moved.bin'))
          if (operation === 'write')
            return nativePort.open(full('sample.bin'), constants.O_WRONLY | constants.O_TRUNC)
          if (operation === 'remove') return nativePort.unlink(full('sample.bin'))
          if (operation === 'mkdir') return nativePort.mkdir(full('new-folder'))
          return nativePort.link(full('incoming.tmp'), full('published.bin'))
        }
        const guarded = guardedVaultAdapter(checked)
        if (operation === 'rename') return guarded.rename('sample.bin', 'moved.bin')
        if (operation === 'write') return guarded.writeBinary('sample.bin', payload.buffer)
        if (operation === 'remove') return guarded.remove('sample.bin')
        if (operation === 'mkdir') return guarded.mkdir('new-folder')
        return guarded.rename('incoming.tmp', 'published.bin')
      }
      const work = Promise.resolve(invoke()).then(async (answer: unknown) => {
        if (answer && typeof answer === 'object' && 'close' in answer)
          await (answer as { close(): Promise<void> }).close()
      })
      const settled = work.catch(() => {})
      const result = lease.wait(work).catch((error: unknown) => error)
      try {
        await vi.advanceTimersByTimeAsync(0)
        await entered.promise
        await vi.advanceTimersByTimeAsync(2000)
        expect(await result).toMatchObject({ leaseExpired: true })
        const savedPath = operation === 'publish' ? 'published.bin' : 'sample.bin'
        await adapter.writeBinary(savedPath, saved)
        resume.resolve()
        await settled
        expect(lateSubmissions).toBe(1)
        const remaining = (await adapter.exists(savedPath))
          ? await adapter.readBinary(savedPath)
          : null
        expect
          .soft(remaining === null ? null : [...new Uint8Array(remaining)])
          .toEqual([...new Uint8Array(saved)])
      } finally {
        resume.resolve()
        await settled
        lease()
        loud.mockRestore()
        vi.useRealTimers()
      }
    })
  })
