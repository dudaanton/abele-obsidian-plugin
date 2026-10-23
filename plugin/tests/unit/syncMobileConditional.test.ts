import { expect, it, vi } from 'vitest'
import { sha256, SyncCancelled } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { MOBILE_WHOLE_READ_MAX } from '@/sync/mobileWholeRead'
import { countPullOperation, emptyPullCounts } from '@/sync/pullOperationCounts'
import { adapterPathGate } from '@/sync/vaultPathLinks'
import { deferred } from '../helpers/deferred'

const bytes = (value: string) => new TextEncoder().encode(value)

it('stops real incoming recovery after its mkdir acknowledgement outlives the lease', async () => {
  vi.useFakeTimers()
  const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
  const stalled = deferred(),
    entered = deferred(),
    resumed = deferred()
  try {
    const app = buildFakeVault([])
    const rename = app.vault.adapter.rename
    app.vault.adapter.rename = async function (...args) {
      if (args[1] === 'sample.bin') throw Object.assign(new Error('occupied'), { code: 'EEXIST' })
      await rename.apply(this, args)
    }
    const disk = new ObsidianFileSystem(app as never)
    const conditional = Reflect.get(disk, 'conditional')
    const host = Reflect.get(conditional, 'host')
    const mkdir = host.mkdir.bind(host)
    host.mkdir = async (path: string) => {
      await mkdir(path)
      entered.resolve()
      await stalled.promise
      resumed.resolve()
    }
    const capture = vi.spyOn(host, 'capture')
    const create = vi.spyOn(host, 'create')
    const remove = vi.spyOn(host, 'remove')
    const recovery = vi.spyOn(conditional, 'recoverIncoming')
    const operation = disk.conditionalFile({
      path: 'sample.bin',
      expected: null,
      effect: { kind: 'write', bytes: bytes('incoming'), mtime: 1000, receipt: 'occupied-real' },
    })
    await vi.advanceTimersByTimeAsync(1999)
    await entered.promise
    expect(recovery).toHaveBeenCalledOnce()
    const recovered = recovery.mock.results[0].value as Promise<void>
    const settled = recovered.catch((error: unknown) => error)
    const evidence = await Reflect.get(disk, 'journal').currentEntries()
    expect(evidence).toHaveLength(1)
    const saving = app.vault.adapter.writeBinary('sample.bin', bytes('local save').buffer)
    await vi.advanceTimersByTimeAsync(1)
    expect(await operation).toBe(false)
    await saving
    stalled.resolve()
    await resumed.promise
    await settled
    expect(capture).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(await Reflect.get(disk, 'journal').currentEntries()).toEqual(evidence)
    expect(await app.vault.adapter.read('sample.bin')).toBe('local save')
    expect((await app.vault.adapter.list('')).files).toEqual(['sample.bin'])
  } finally {
    stalled.resolve()
    loud.mockRestore()
    vi.useRealTimers()
  }
})

it('bounds buffered conflict recovery by the same checked lease', async () => {
  vi.useFakeTimers()
  const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
  const stalled = deferred<void>()
  try {
    const app = buildFakeVault([])
    const rename = app.vault.adapter.rename
    app.vault.adapter.rename = async function (...args) {
      if (args[1] === 'sample.bin') throw Object.assign(new Error('occupied'), { code: 'EEXIST' })
      await rename.apply(this, args)
    }
    const disk = new ObsidianFileSystem(app as never)
    const recovery = vi
      .spyOn(Reflect.get(disk, 'conditional'), 'recoverIncoming')
      .mockImplementation(() => stalled.promise)
    const operation = disk.conditionalFile({
      path: 'sample.bin',
      expected: null,
      effect: { kind: 'write', bytes: bytes('incoming'), mtime: 1000, receipt: 'occupied' },
    })
    let result: boolean | undefined
    void operation.then((value) => {
      result = value
    })
    await vi.advanceTimersByTimeAsync(1999)
    expect(recovery).toHaveBeenCalledOnce()
    const saving = app.vault.adapter.writeBinary('sample.bin', bytes('local save').buffer)
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBe(false)
    await saving
    stalled.resolve()
    await operation
    expect(await app.vault.adapter.read('sample.bin')).toBe('local save')
  } finally {
    stalled.resolve()
    loud.mockRestore()
    vi.useRealTimers()
  }
})

it('refuses quietly when a failed capture reaches the deadline during restoration', async () => {
  vi.useFakeTimers()
  const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000 }])
    const previous = app.vault.adapter.rename
    app.vault.adapter.rename = async function (...args) {
      await previous.apply(this, args)
      if (args[1].endsWith('/victim')) throw new Error('capture acknowledgement failed')
      if (args[1] === 'sample.bin')
        await app.vault.adapter.writeBinary('sample.bin', bytes('local save').buffer)
    }
    const disk = new ObsidianFileSystem(app as never)
    const operation = disk.conditionalFile({
      path: 'sample.bin',
      expected: { sha: await sha256(bytes('before')), size: 6, mtime: 1000 },
      effect: { kind: 'remove' },
    })
    const result = operation.then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(2000)
    expect(await result).toBe(false)
    expect(await app.vault.adapter.read('sample.bin')).toBe('local save')
    expect(loud).toHaveBeenCalledOnce()
  } finally {
    loud.mockRestore()
    vi.useRealTimers()
  }
})

it('refuses a stalled publication at the lease deadline and preserves a later acknowledgement', async () => {
  vi.useFakeTimers()
  const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
  const stalled = deferred<void>()
  try {
    const app = buildFakeVault([])
    const previous = app.vault.adapter.rename
    let reached = false
    app.vault.adapter.rename = async function (...args) {
      await previous.apply(this, args)
      if (args[1] === 'sample.bin') {
        reached = true
        await stalled.promise
      }
    }
    const disk = new ObsidianFileSystem(app as never)
    const operation = disk.conditionalFile({
      path: 'sample.bin',
      expected: null,
      effect: { kind: 'write', bytes: bytes('incoming'), mtime: 1000, receipt: 'stalled' },
    })
    let result: boolean | undefined
    void operation.then((value) => {
      result = value
    })
    await vi.advanceTimersByTimeAsync(1999)
    expect(reached).toBe(true)
    const saving = app.vault.adapter.writeBinary('sample.bin', bytes('local save').buffer)
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBe(false)
    await saving
    stalled.resolve()
    await operation
    await disk.recoverConditionalFiles()
    expect(await app.vault.adapter.read('sample.bin')).toBe('local save')
    expect(loud).toHaveBeenCalledOnce()
  } finally {
    stalled.resolve()
    loud.mockRestore()
    vi.useRealTimers()
  }
})

it('refuses an expired publication lease when a reentrant event awaits a user save', async () => {
  vi.useFakeTimers()
  const loud = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000 }])
    const previous = app.vault.adapter.rename
    let notified = false
    let published = ''
    app.vault.adapter.rename = async function (...args) {
      await previous.apply(this, args)
      if (args[1] === 'sample.bin' && !notified) {
        notified = true
        published = await app.vault.adapter.read('sample.bin')
        await app.vault.adapter.writeBinary('sample.bin', bytes('local save').buffer, {
          mtime: 3000,
        })
      }
    }
    const disk = new ObsidianFileSystem(app as never)
    const operation = disk.conditionalFile({
      path: 'sample.bin',
      expected: { sha: await sha256(bytes('before')), size: 6, mtime: 1000 },
      effect: { kind: 'write', bytes: bytes('incoming'), mtime: 2000 },
    })
    await vi.advanceTimersByTimeAsync(1999)
    expect(notified).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(await operation).toBe(false)
    expect(loud).toHaveBeenCalledOnce()
    expect(await app.vault.adapter.read('sample.bin')).toBe('local save')
    await disk.recoverConditionalFiles()
    const files = app.vault.adapter.list('')
    const contents = await Promise.all(
      (await files).files.map((path) => app.vault.adapter.read(path))
    )
    expect(contents).toContain('before')
    expect(published).toBe('incoming')
    expect(await app.vault.adapter.read('sample.bin')).toBe('local save')
  } finally {
    loud.mockRestore()
    vi.useRealTimers()
  }
})

it.each(['before', 'after'] as const)(
  'publishes beneath nested forwarding wrappers installed %s the gate',
  async (when) => {
    const app = buildFakeVault([])
    const wrap = () => {
      const previous = app.vault.adapter.rename
      app.vault.adapter.rename = async function (...args) {
        return previous.apply(this, args)
      }
    }
    if (when === 'before') {
      wrap()
      wrap()
    }
    adapterPathGate(app.vault.adapter)
    if (when === 'after') {
      wrap()
      wrap()
    }
    const disk = new ObsidianFileSystem(app as never)
    let timer: ReturnType<typeof setTimeout>
    try {
      expect(
        await Promise.race([
          disk.conditionalFile({
            path: 'sample.bin',
            expected: null,
            effect: { kind: 'write', bytes: bytes('incoming'), mtime: 1000 },
          }),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve('deadlocked'), 100)
          }),
        ])
      ).toBe(true)
      expect(await app.vault.adapter.read('sample.bin')).toBe('incoming')
    } finally {
      clearTimeout(timer!)
    }
  }
)

it.each(['remove', 'write', 'move'] as const)(
  'refuses %s when same-size same-time content changes after hashing',
  async (kind) => {
    const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000 }])
    const raw = app.vault.adapter.writeBinary.bind(app.vault.adapter)
    let changed = false
    Object.defineProperty(app.vault.adapter, 'promise', {
      get() {
        if (!changed) {
          changed = true
          return raw('sample.bin', bytes('edited').buffer, { mtime: 1000 })
        }
        return undefined
      },
    })
    const disk = new ObsidianFileSystem(app as never)
    const effect =
      kind === 'write'
        ? { kind, bytes: bytes('incoming'), mtime: 2000 }
        : kind === 'move'
          ? { kind, to: 'other.bin' }
          : { kind }
    expect(
      await disk.conditionalFile({
        path: 'sample.bin',
        expected: { sha: await sha256(bytes('before')), size: 6, mtime: 1000 },
        effect,
      })
    ).toBe(false)
    expect(await app.vault.adapter.read('sample.bin')).toBe('edited')
    expect(await app.vault.adapter.exists('other.bin')).toBe(false)
  }
)

it.each(['error', 'cancel'] as const)(
  'releases a queued save when capture ends with %s',
  async (kind) => {
    const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000 }])
    const rename = app.vault.adapter.rename.bind(app.vault.adapter)
    const failure = kind === 'cancel' ? new SyncCancelled() : new Error('capture failed')
    let saving: Promise<void> | undefined
    vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to)
      if (from === 'sample.bin' && to.endsWith('/victim')) {
        saving = app.vault.adapter.writeBinary('sample.bin', bytes('saved later').buffer)
        throw failure
      }
    })
    const disk = new ObsidianFileSystem(app as never)
    await expect(
      disk.conditionalFile({
        path: 'sample.bin',
        expected: { sha: await sha256(bytes('before')), size: 6, mtime: 1000 },
        effect: { kind: 'write', bytes: bytes('incoming'), mtime: 2000 },
      })
    ).rejects.toBe(failure)
    await saving
    expect(await app.vault.adapter.read('sample.bin')).toBe('saved later')
  }
)

it('preserves a save recreating the path immediately before publication', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000 }])
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  let captured = false,
    injected = false
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to)
    if (from === 'sample.bin' && to.endsWith('/victim')) captured = true
  })
  vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
    const result = await stat(path)
    if (path === 'sample.bin' && captured && !result && !injected) {
      injected = true
      // An out-of-gate writer at the last absence observation reproduces the publication race.
      await write(path, bytes('local save').buffer, { mtime: 3000 })
    }
    return result
  })
  const disk = new ObsidianFileSystem(app as never)
  expect(
    await disk.conditionalFile({
      path: 'sample.bin',
      expected: { sha: await sha256(bytes('before')), size: 6, mtime: 1000 },
      effect: { kind: 'write', bytes: bytes('incoming'), mtime: 2000, receipt: 'race' },
    })
  ).toBe(false)
  expect(injected).toBe(true)
  expect(await app.vault.adapter.read('sample.bin')).toBe('local save')
  const visible = (await app.vault.adapter.list('')).files.filter((path) => path !== 'sample.bin')
  expect(await Promise.all(visible.map((path) => app.vault.adapter.read(path)))).toContain(
    'incoming'
  )
  await disk.discardInstallation('race')
  expect(
    await app.vault.adapter.exists('.obsidian/plugins/abele/sync-conditional/objects/race')
  ).toBe(false)
  expect(await Promise.all(visible.map((path) => app.vault.adapter.read(path)))).toContain(
    'incoming'
  )
})

it.each([false, true])(
  'queues a save inside checked publication (existing=%s)',
  async (existing) => {
    const app = buildFakeVault(
      existing ? [{ path: 'sample.bin', content: 'before', mtime: 1000 }] : []
    )
    const rename = app.vault.adapter.rename.bind(app.vault.adapter)
    let saving: Promise<void> | undefined,
      saved = false
    vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to)
      if (existing ? from === 'sample.bin' && to.endsWith('/victim') : to === 'sample.bin') {
        saving = app.vault.adapter
          .writeBinary('sample.bin', bytes('local save').buffer, { mtime: 3000 })
          .then(() => {
            saved = true
          })
        await Promise.resolve()
        expect(saved).toBe(false)
      }
    })
    const disk = new ObsidianFileSystem(app as never)
    expect(
      await disk.conditionalFile({
        path: 'sample.bin',
        expected: existing ? { sha: await sha256(bytes('before')), size: 6, mtime: 1000 } : null,
        effect: { kind: 'write', bytes: bytes('incoming'), mtime: 2000 },
      })
    ).toBe(true)
    await saving
    expect(saved).toBe(true)
    expect(await app.vault.adapter.read('sample.bin')).toBe('local save')
  }
)
async function fixture() {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000 }])
  const disk = new ObsidianFileSystem(app as never)
  const expected = { sha: await sha256(bytes('before')), size: 6, mtime: 1000 }
  const write = () =>
    disk.conditionalFile({
      path: 'sample.bin',
      expected,
      effect: {
        kind: 'write',
        bytes: bytes('after'),
        mtime: 2000,
        receipt: 'sample-mobile',
      },
    })
  return { app, disk, expected, write }
}

it('uses fresh content rather than a cached base when an edit lands before decision', async () => {
  const { app, disk, write } = await fixture()
  await disk.fingerprint('sample.bin')
  await app.vault.adapter.writeBinary('sample.bin', bytes('edited').buffer, { mtime: 1000 })
  expect(await write()).toBe(false)
  expect(await app.vault.adapter.read('sample.bin')).toBe('edited')
})

it('treats a file changed during fresh hashing as a retryable refusal', async () => {
  const { app, write } = await fixture()
  const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
  let injected = false
  vi.spyOn(app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
    const value = await read(path)
    if (path === 'sample.bin' && !injected) {
      injected = true
      await app.vault.adapter.writeBinary(path, bytes('edited').buffer, { mtime: 2000 })
    }
    return value
  })
  expect(await write()).toBe(false)
  expect(injected).toBe(true)
  expect(await app.vault.adapter.read('sample.bin')).toBe('edited')
})

it('propagates unreadable local bytes without capturing or replacing them', async () => {
  const { app, write } = await fixture()
  const failure = Object.assign(new Error('unreadable'), { code: 'EIO' })
  vi.spyOn(app.vault.adapter, 'readBinary').mockRejectedValue(failure)
  const capture = vi.spyOn(app.vault.adapter, 'rename')
  await expect(write()).rejects.toBe(failure)
  expect(capture).not.toHaveBeenCalled()
})

it.each(['queue', 'saving'] as const)(
  'refuses an edit during the pending %s without moving it',
  async (kind) => {
    const { app, write } = await fixture()
    let pending: Promise<void> | undefined
    // Start the save only when the checked decision reaches its save barrier.
    const save = {
      then: (resolve: () => void, reject: (error: unknown) => void) => {
        pending ??= app.vault.adapter.writeBinary('sample.bin', bytes('edited!').buffer, {
          mtime: 2000,
        })
        return pending.then(resolve, reject)
      },
    }
    if (kind === 'queue') Object.defineProperty(app.vault.adapter, 'promise', { get: () => save })
    else
      Object.defineProperty(app.vault.getFileByPath('sample.bin')!, 'saving', { get: () => save })
    expect(await write()).toBe(false)
    expect(pending).toBeDefined()
    expect(await app.vault.adapter.read('sample.bin')).toBe('edited!')
    expect(
      (await app.vault.adapter.list('.obsidian/plugins/abele/sync-conditional/objects')).folders
    ).toEqual([])
  }
)

it.each(['mtime', 'size'] as const)(
  'refuses a changed %s between decision stats',
  async (change) => {
    const { app, write } = await fixture()
    const rawWrite = app.vault.adapter.writeBinary.bind(app.vault.adapter)
    let barrier = false,
      injected = false
    Object.defineProperty(app.vault.adapter, 'promise', {
      get: () => {
        barrier = true
        return undefined
      },
    })
    const stat = app.vault.adapter.stat.bind(app.vault.adapter)
    vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
      if (barrier && !injected && path === 'sample.bin') {
        injected = true
        await rawWrite(path, bytes(change === 'size' ? 'longer content' : 'before').buffer, {
          mtime: change === 'mtime' ? 2000 : 1000,
        })
      }
      return stat(path)
    })
    expect(await write()).toBe(false)
    expect(injected).toBe(true)
    expect(await app.vault.adapter.read('sample.bin')).toBe(
      change === 'size' ? 'longer content' : 'before'
    )
  }
)

it('uses adapter publication for an unindexed replacement', async () => {
  const app = buildFakeVault([{ path: '.obsidian/sample.json', content: 'before', mtime: 1000 }])
  const disk = new ObsidianFileSystem(app as never)
  const modify = vi.spyOn(app.vault, 'modifyBinary')
  expect(
    await disk.conditionalFile({
      path: '.obsidian/sample.json',
      expected: { sha: await sha256(bytes('before')), size: 6, mtime: 1000 },
      effect: { kind: 'write', bytes: bytes('after'), mtime: 2000 },
    })
  ).toBe(true)
  expect(modify).not.toHaveBeenCalled()
  expect(await app.vault.adapter.read('.obsidian/sample.json')).toBe('after')
})

it('never follows a moved indexed object into another path during publication', async () => {
  const { app, write } = await fixture()
  const file = app.vault.getFileByPath('sample.bin')!
  await app.vault.adapter.writeBinary('other.bin', bytes('other').buffer, { mtime: 1000 })
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to)
    if (to.endsWith('/victim')) file.path = 'other.bin'
  })
  expect(await write()).toBe(false)
  expect(await app.vault.adapter.read('other.bin')).toBe('other')
  expect(await app.vault.adapter.read('sample.bin')).toBe('before')
})

it('restores a real empty file after a lost capture acknowledgement', async () => {
  const app = buildFakeVault([{ path: 'empty.bin', content: '', mtime: 1000 }])
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to)
    if (to.endsWith('/victim')) throw new Error('lost capture acknowledgement')
  })
  const disk = new ObsidianFileSystem(app as never)
  await expect(
    disk.conditionalFile({
      path: 'empty.bin',
      expected: { sha: await sha256(bytes('')), size: 0, mtime: 1000 },
      effect: { kind: 'remove' },
    })
  ).rejects.toThrow('lost capture acknowledgement')
  await new ObsidianFileSystem(app as never).recoverConditionalFiles()
  expect(await app.vault.adapter.exists('empty.bin')).toBe(true)
  expect(await app.vault.adapter.read('empty.bin')).toBe('')
})

it('does not replay an uncertain create over a later edit', async () => {
  const app = buildFakeVault([])
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  const publish = vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to)
    if (to === 'new.bin') throw new Error('lost create acknowledgement')
  })
  const disk = new ObsidianFileSystem(app as never)
  const operation = {
    path: 'new.bin',
    expected: null,
    effect: { kind: 'write' as const, bytes: bytes('new'), mtime: 2000, receipt: 'sample-create' },
  }
  await expect(disk.conditionalFile(operation)).rejects.toThrow('lost create acknowledgement')
  await app.vault.adapter.writeBinary('new.bin', bytes('later').buffer, { mtime: 3000 })
  expect(await disk.conditionalFile(operation)).toBe(false)
  expect(publish).toHaveBeenCalledOnce()
  expect(await app.vault.adapter.read('new.bin')).toBe('later')
  expect(await disk.installedFile('sample-create', 'new.bin', await sha256(bytes('later')))).toBe(
    false
  )
})

it('publishes indexed replacements exclusively and retains displaced bytes', async () => {
  const { app, disk, write } = await fixture()
  const modify = vi.spyOn(app.vault, 'modifyBinary')
  expect(await write()).toBe(true)
  expect(modify).not.toHaveBeenCalled()
  expect(await app.vault.adapter.read('sample.bin')).toBe('after')
  const root = '.obsidian/plugins/abele/sync-conditional/objects/sample-mobile'
  expect(await app.vault.adapter.exists(root + '/allocation')).toBe(false)
  expect(await app.vault.adapter.exists(root + '/victim')).toBe(false)
  expect(
    await app.vault.adapter.read(
      '.obsidian/plugins/abele/sync-conditional/trash/sample-mobile/victim'
    )
  ).toBe('before')
  expect(
    await disk.installedFile('sample-mobile', 'sample.bin', await sha256(bytes('after')))
  ).toBe(false)
})

it('creates absent public files by moving a private payload exclusively', async () => {
  const app = buildFakeVault([])
  const create = vi.spyOn(app.vault.adapter, 'rename')
  expect(
    await new ObsidianFileSystem(app as never).conditionalFile({
      path: 'new.bin',
      expected: null,
      effect: { kind: 'write', bytes: bytes('new'), mtime: 2000 },
    })
  ).toBe(true)
  expect(create).toHaveBeenCalledOnce()
})

it('counts exclusive creation as one payload write and one publication', async () => {
  const counts = emptyPullCounts()
  const app = buildFakeVault([])
  const disk = new ObsidianFileSystem(app as never, {
    diagnostic: (operation) => countPullOperation(counts, operation),
  })
  await disk.conditionalFile({
    path: 'new.bin',
    expected: null,
    effect: { kind: 'write', bytes: bytes('new'), mtime: 2000 },
  })
  expect(counts).toMatchObject({ writes: 1, publications: 1, journal: 2 })
})

it('refuses a directory without moving its children', async () => {
  const { app, write } = await fixture()
  await app.vault.adapter.remove('sample.bin')
  await app.vault.adapter.mkdir('sample.bin')
  await app.vault.adapter.writeBinary('sample.bin/child', bytes('child').buffer)
  expect(await write()).toBe(false)
  expect(await app.vault.adapter.read('sample.bin/child')).toBe('child')
})

it('refuses an oversized whole-file decision before reading or mutating bytes', async () => {
  const { app, write } = await fixture()
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
    const info = await stat(path)
    return path === 'sample.bin' && info ? { ...info, size: MOBILE_WHOLE_READ_MAX + 1 } : info
  })
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  expect(await write()).toBe(false)
  expect(read).not.toHaveBeenCalled()
  expect(await app.vault.adapter.read('sample.bin')).toBe('before')
})

it('preserves both versions after a lost write acknowledgement and never adopts by equality', async () => {
  const { app, disk, write } = await fixture()
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to)
    if (to === 'sample.bin' && from.endsWith('/data')) throw new Error('lost acknowledgement')
  })
  await expect(write()).rejects.toThrow('lost acknowledgement')
  expect(await app.vault.adapter.read('sample.bin')).toBe('after')
  await new ObsidianFileSystem(app as never).recoverConditionalFiles()
  expect(await app.vault.adapter.read('sample.bin')).toBe('after')
  const visible = (await app.vault.adapter.list('')).files.filter((path) => path !== 'sample.bin')
  expect(await Promise.all(visible.map((path) => app.vault.adapter.read(path)))).toContain('before')
  expect(
    await disk.installedFile('sample-mobile', 'sample.bin', await sha256(bytes('after')))
  ).toBe(false)
})
