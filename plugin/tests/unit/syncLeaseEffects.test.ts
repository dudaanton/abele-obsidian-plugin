import { constants } from 'node:fs'
import { desktopFsPort } from '../helpers/desktopRequire'
import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { checkedVaultPort } from '@/sync/vaultPathLinks'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'
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
      expect(effects, `late effects after ${cut}: ${trace[cut]}`).toEqual(before)
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
  'stops every adapter continuation (native=$native, path=$path, shard=$shard)',
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
