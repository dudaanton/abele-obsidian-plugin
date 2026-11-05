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

async function repairCut(native: boolean, cut?: number) {
  const fixture = native ? virtualNativeVault() : undefined
  const app = fixture?.app ?? buildFakeVault([])
  if (fixture) desktopFsPort(fixture.native)
  const raw = app.vault.adapter
  const conditional = Reflect.get(new ObsidianFileSystem(app as never), 'conditional')
  const host = Reflect.get(conditional, 'host')
  const id = 'sample-two-version-repair',
    folder = host.root + '/objects/' + id
  const original = new Uint8Array([0, 255, 16, 128]),
    incoming = new Uint8Array([254, 0, 64])
  const intent = {
    checked: true,
    path: 'sample.bin',
    destination: 'sample.bin',
    expected: { size: original.length, sha: await sha256(original), mtime: 1000 },
    data: folder + '/data',
    kind: 'write',
  }
  await host.mkdir(folder)
  await host.mkdir(host.root + '/active')
  await host.create(folder + '/victim', original, 1000)
  await host.create(folder + '/data', incoming, 2000)
  const record = bytes(JSON.stringify(intent))
  await host.create(folder + '/intent.json', record, 0)
  await host.create(host.root + '/active/' + id + '.json', record, 0)
  const trace: string[] = []
  let stopped = false
  const killed = new Error('process stopped')
  const check = host.check
  host.check = () => {
    if (stopped) throw killed
    check()
  }
  for (const method of [
    'stat',
    'fingerprint',
    'create',
    'read',
    'mkdir',
    'list',
    'capture',
    'install',
    'restoreDirectory',
    'flush',
    'sameObject',
    'remove',
    'rmdir',
  ]) {
    const originalMethod = Reflect.get(host, method)
    if (typeof originalMethod !== 'function') continue
    Reflect.set(host, method, async (...args: unknown[]) => {
      if (stopped) throw killed
      const ordinal = trace.push(method + ':' + String(args[0])) - 1
      const answer = await originalMethod.apply(host, args)
      if (ordinal === cut) {
        stopped = true
        throw killed
      }
      return answer
    })
  }
  const key = host.root + '/' + id
  host.active.add(key)
  try {
    const result = await conditional.repairIntent(folder, id).then(
      () => null,
      (error: unknown) => error
    )
    if (cut === undefined) expect(result).toBeNull()
    else {
      expect(stopped).toBe(true)
      expect(result).toBe(killed)
    }
  } finally {
    host.active.delete(key)
  }
  // A new host has no stopped continuations, but exactly the surviving disk state.
  const recovery = Reflect.get(new ObsidianFileSystem(app as never), 'conditional')
  await recovery.recover()
  const files = (await raw.list('')).files.sort()
  const contents = await Promise.all(
    files.map(async (file) => [...new Uint8Array(await raw.readBinary(file))])
  )
  expect(contents, `original after ${cut}: ${trace[cut ?? 0]}`).toContainEqual([...original])
  expect(contents, `incoming after ${cut}: ${trace[cut ?? 0]}`).toContainEqual([...incoming])
  expect(
    contents.filter((value) => JSON.stringify(value) === JSON.stringify([...original]))
  ).toHaveLength(1)
  expect(
    contents.filter((value) => JSON.stringify(value) === JSON.stringify([...incoming]))
  ).toHaveLength(1)
  await recovery.recover()
  expect((await raw.list('')).files.sort()).toEqual(files)
  return trace
}

it.each(
  [false, true].flatMap((native) => {
    // Preserve every continuation cut and the five-second case limit. Native
    // deadline/identity wrappers add continuations; partition the full matrix.
    const shards = native ? 16 : 1
    return Array.from({ length: shards }, (_, shard) => ({ native, shard, shards }))
  })
)(
  'recovers both versions after every repair await (native=$native, shard=$shard)',
  async ({ native, shard, shards }) => {
    const baseline = await repairCut(native)
    let checked = 0
    for (let cut = shard; cut < baseline.length; cut += shards) {
      await repairCut(native, cut)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
    console.debug('[two-version repair crash cuts]', { native, cuts: baseline.length })
  }
)

it('keeps a late replacement recoverable between victim and incoming restoration', async () => {
  vi.useFakeTimers()
  const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
  const app = buildFakeVault([]),
    raw = app.vault.adapter
  await raw.writeBinary('sample.bin', bytes('base').buffer)
  const stat = await raw.stat('sample.bin')
  const entered = deferred(),
    resume = deferred()
  const rename = raw.rename
  raw.rename = async function (from, to) {
    if (from === 'sample.bin' && to.endsWith('/victim')) {
      entered.resolve()
      await resume.promise
    }
    await rename.call(this, from, to)
  }
  const conditional = Reflect.get(new ObsidianFileSystem(app as never), 'conditional')
  const host = Reflect.get(conditional, 'host'),
    observe = host.stat,
    check = host.check
  let stopped = false
  host.check = () => {
    if (stopped) throw new Error('process stopped')
    check()
  }
  host.stat = async (path: string) => {
    if (path.endsWith('/data-restored')) {
      stopped = true
      throw new Error('process stopped')
    }
    return observe(path)
  }
  try {
    const work = conditional.apply({
      path: 'sample.bin',
      expected: { sha: await sha256(bytes('base')), size: 4, mtime: stat!.mtime },
      effect: { kind: 'write', bytes: bytes('incoming'), mtime: 2000 },
    })
    await vi.advanceTimersByTimeAsync(0)
    await entered.promise
    await vi.advanceTimersByTimeAsync(2000)
    expect(await work).toBe(false)
    await raw.writeBinary('sample.bin', bytes('new user save').buffer)
    resume.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(Reflect.get(conditional, 'lateRepairs'))
    expect(stopped).toBe(true)
    expect((await raw.list(host.root + '/active')).files).toHaveLength(1)
    const recovery = Reflect.get(new ObsidianFileSystem(app as never), 'conditional')
    await recovery.recover()
    const files = (await raw.list('')).files.sort()
    const contents = await Promise.all(
      files.map(async (file) => [...new Uint8Array(await raw.readBinary(file))])
    )
    expect(contents).toContainEqual([...bytes('new user save')])
    expect(contents).toContainEqual([...bytes('incoming')])
    await recovery.recover()
    expect((await raw.list('')).files.sort()).toEqual(files)
  } finally {
    resume.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(Reflect.get(conditional, 'lateRepairs'))
    loud.mockRestore()
    vi.useRealTimers()
  }
})

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

it('keeps both versions recoverable when publication repair fails through the checked caller', async () => {
  const app = buildFakeVault([]),
    raw = app.vault.adapter
  await raw.writeBinary('sample.bin', bytes('original').buffer)
  const save = raw.writeBinary.bind(raw)
  const disk = new ObsidianFileSystem(app as never)
  const conditional = Reflect.get(disk, 'conditional'),
    host = Reflect.get(conditional, 'host')
  const install = host.install,
    stat = host.stat
  let refusePublish = true,
    interruptIncoming = true
  host.install = async (from: string, to: string) => {
    if (refusePublish && to === 'sample.bin' && from.endsWith('/data')) {
      refusePublish = false
      await save('sample.bin', bytes('competing').buffer)
      throw Object.assign(new Error('EEXIST occupied'), { code: 'EEXIST' })
    }
    return install(from, to)
  }
  host.stat = async (path: string) => {
    if (!refusePublish && interruptIncoming && path.endsWith('/data-restored')) {
      interruptIncoming = false
      throw Object.assign(new Error('EEXIST interrupted restoration'), { code: 'EEXIST' })
    }
    return stat(path)
  }
  host.withMutationCheck = undefined
  await conditional
    .apply({
      path: 'sample.bin',
      expected: {
        sha: await sha256(bytes('original')),
        size: 8,
        mtime: (await raw.stat('sample.bin'))!.mtime,
      },
      effect: { kind: 'write', bytes: bytes('incoming'), mtime: 2000 },
    })
    .catch(() => {})
  expect(interruptIncoming).toBe(false)
  const recovery = Reflect.get(new ObsidianFileSystem(app as never), 'conditional')
  await recovery.recover()
  const files = (await raw.list('')).files.sort()
  const content = await Promise.all(
    files.map(async (path) => [...new Uint8Array(await raw.readBinary(path))])
  )
  expect(content).toContainEqual([...bytes('original')])
  expect(content).toContainEqual([...bytes('incoming')])
  await recovery.recover()
  expect((await raw.list('')).files.sort()).toEqual(files)
})
