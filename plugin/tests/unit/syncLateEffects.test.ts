import { expect, it, vi } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'
import { constants } from 'node:fs'
import { virtualNativeVault } from '../helpers/virtualNativeVault'
import { desktopFsPort } from '../helpers/desktopRequire'
import { checkedVaultPort } from '@/sync/vaultPathLinks'

const bytes = (text: string) => new TextEncoder().encode(text)

it.each([false, true])('repairs a late incoming recovery capture (native=%s)', async (native) => {
  vi.useFakeTimers()
  const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
  const fixture = native ? virtualNativeVault() : undefined
  const app = fixture?.app ?? buildFakeVault([])
  if (fixture) desktopFsPort(fixture.native)
  const raw = app.vault.adapter
  await raw.writeBinary('incoming.tmp', bytes('incoming').buffer)
  await raw.writeBinary('sample.bin', bytes('local').buffer)
  const entered = deferred(),
    resume = deferred()
  const target = fixture?.native ?? raw
  const rename = target.rename
  let once = true
  target.rename = async (...args: [string, string]) => {
    if (once && args[0].endsWith('incoming.tmp')) {
      once = false
      entered.resolve()
      await resume.promise
    }
    return rename.apply(target, args)
  }
  const disk = new ObsidianFileSystem(app as never)
  const conditional = Reflect.get(disk, 'conditional')
  const port = checkedVaultPort(app.vault as never, raw as never, {
    ready() {},
    effect: (work) => work(),
  })
  const lease = await port.acquire(['incoming.tmp', 'sample.bin'])
  const work = conditional
    .recoverIncoming('incoming.tmp', 'sample.bin', lease)
    .catch((error: unknown) => error)
  try {
    await vi.advanceTimersByTimeAsync(0)
    await entered.promise
    await vi.advanceTimersByTimeAsync(2000)
    expect(await work).toMatchObject({ leaseExpired: true })
    await raw.writeBinary('sample.bin', bytes('new user save').buffer)
    await conditional.recover()
    resume.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(Reflect.get(conditional, 'lateRepairs') ?? [])
    const recovery = Reflect.get(new ObsidianFileSystem(app as never), 'conditional')
    await recovery.recover()
    const files = (await raw.list('')).files.sort()
    await recovery.recover()
    expect((await raw.list('')).files.sort()).toEqual(files)
    const contents = await Promise.all(
      files.map(async (path) => [...new Uint8Array(await raw.readBinary(path))])
    )
    expect(contents).toContainEqual([...bytes('incoming')])
    expect([...new Uint8Array(await raw.readBinary('sample.bin'))]).toEqual([
      ...bytes('new user save'),
    ])
  } finally {
    resume.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(Reflect.get(conditional, 'lateRepairs') ?? [])
    lease()
    loud.mockRestore()
    vi.useRealTimers()
  }
})

it('models truncation when the native fixture opens an existing file for overwrite', async () => {
  const fixture = virtualNativeVault()
  await fixture.app.vault.adapter.writeBinary('sample.bin', bytes('saved bytes').buffer)
  const handle = await fixture.native.open('sample.bin', constants.O_WRONLY | constants.O_TRUNC)
  expect((await handle.readFile()).length).toBe(0)
  await handle.close()
})

it.each([
  'vacant',
  'occupied',
  'restart',
  'restart-after-record',
  'restart-after-restore',
] as const)('repairs a capture arriving after lease expiry (%s)', async (mode) => {
  vi.useFakeTimers()
  const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
  const diagnostics = vi.spyOn(console, 'debug').mockImplementation(() => {})
  const app = buildFakeVault([])
  const raw = app.vault.adapter
  await raw.writeBinary('sample.bin', bytes('base').buffer)
  const before = await raw.stat('sample.bin')
  const entered = deferred(),
    resume = deferred(),
    moved = deferred(),
    acknowledge = deferred()
  const rename = raw.rename
  let once = true
  raw.rename = async function (from, to) {
    if (once && from === 'sample.bin' && to.endsWith('/victim')) {
      once = false
      entered.resolve()
      await resume.promise
      await rename.call(this, from, to)
      moved.resolve()
      await acknowledge.promise
      return
    }
    return rename.call(this, from, to)
  }
  const disk = new ObsidianFileSystem(app as never)
  const conditional = Reflect.get(disk, 'conditional')
  const host = Reflect.get(conditional, 'host')
  const create = host.create
  host.create = async (path: string, data: Uint8Array, mtime: number) => {
    if (mode === 'restart' && path.endsWith('/late-effect.json')) throw new Error('process stopped')
    await create(path, data, mtime)
    if (mode === 'restart-after-record' && path.endsWith('/late-effect.json'))
      throw new Error('process stopped')
  }
  const install = host.install
  host.install = async (from: string, to: string) => {
    await install(from, to)
    if (mode === 'restart-after-restore' && to === 'sample.bin') throw new Error('process stopped')
  }
  try {
    const work = disk.conditionalFile({
      path: 'sample.bin',
      expected: { size: 4, mtime: before!.mtime, sha: await sha256(bytes('base')) },
      effect: { kind: 'remove' },
    })
    await vi.advanceTimersByTimeAsync(0)
    await entered.promise
    await vi.advanceTimersByTimeAsync(2000)
    expect(await work).toBe(false)
    await raw.writeBinary('sample.bin', bytes('new user bytes').buffer)
    // Recovery while the wrapper is alive must not settle an empty victim record.
    await conditional.recover()
    resume.resolve()
    await moved.promise
    if (mode === 'occupied') await raw.writeBinary('sample.bin', bytes('another save').buffer)
    acknowledge.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(Reflect.get(conditional, 'lateRepairs') ?? [])
    expect(diagnostics).toHaveBeenCalledWith(
      '[abele-sync] mutation outlived checked lease; possible slow wrapper',
      'rename'
    )
    if (mode !== 'restart') {
      const objects = await raw.list(host.root + '/objects')
      const records = (
        await Promise.all(
          objects.folders.map(async (folder) => {
            const path = folder + '/late-effect.json'
            return (await raw.exists(path))
              ? JSON.parse(new TextDecoder().decode(await raw.readBinary(path)))
              : null
          })
        )
      ).filter(Boolean)
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        methods: ['capture'],
        matchesExpected: false,
        captured: { sha: await sha256(bytes('new user bytes')) },
      })
    }
    if (!mode.startsWith('restart')) {
      expect(new TextDecoder().decode(await raw.readBinary('sample.bin'))).toBe(
        mode === 'occupied' ? 'another save' : 'new user bytes'
      )
    }
    const restarted = new ObsidianFileSystem(app as never)
    const recovery = Reflect.get(restarted, 'conditional')
    await recovery.recover()
    const first = (await raw.list('')).files.sort()
    await recovery.recover()
    expect((await raw.list('')).files.sort()).toEqual(first)
    const contents = await Promise.all(
      first.map(async (path) => new TextDecoder().decode(await raw.readBinary(path)))
    )
    expect(contents).toContain('new user bytes')
    expect(new TextDecoder().decode(await raw.readBinary('sample.bin'))).toBe(
      mode === 'occupied' ? 'another save' : 'new user bytes'
    )
    expect(contents.filter((value) => value === 'new user bytes')).toHaveLength(1)
  } finally {
    resume.resolve()
    acknowledge.resolve()
    await vi.advanceTimersByTimeAsync(0)
    loud.mockRestore()
    diagnostics.mockRestore()
    vi.useRealTimers()
  }
})
