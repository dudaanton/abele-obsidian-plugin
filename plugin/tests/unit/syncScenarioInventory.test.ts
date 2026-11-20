import { expect, it, vi } from 'vitest'
import { ExpectedWrites, MemoryStateStore, push, scan, sha256 } from '@abele/sync-sdk/core'
import type { CommitOp } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { ignoreFor } from '@/sync/scope'

it('132 defers ordinary verification until the first sync settles', async () => {
  const app = buildFakeVault([{ path: 'Outside/new.md', content: 'new' }])
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  vi.spyOn(app.vault, 'getFiles').mockReturnValue([])
  const listing = vi.spyOn(app.vault.adapter, 'list')
  const fs = new ObsidianFileSystem(app as never, {
    deferOrdinaryVerification: true,
  })
  const changed = vi.fn()
  const stop = fs.watch(changed)
  const inspect = () => Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)
  try {
    await inspect()
    expect(listing).not.toHaveBeenCalledWith('Outside')
    expect(changed).not.toHaveBeenCalled()
    fs.completeInitialExchange()
    await inspect()
    expect(listing).toHaveBeenCalledWith('Outside')
    expect(changed.mock.calls.flatMap(([paths]) => paths)).toContain('Outside/new.md')
  } finally {
    stop()
  }
})

it('132 discovers and uploads an omitted file while later exchanges span every poll', async () => {
  const path = 'Outside/new.md'
  const app = buildFakeVault([])
  await app.vault.adapter.mkdir('Outside')
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  vi.spyOn(app.vault, 'getFiles').mockReturnValue([])
  const state = new MemoryStateStore()
  const fs = new ObsidianFileSystem(app as never, {
    ledger: state,
    deferOrdinaryVerification: true,
  })
  const changed = vi.fn()
  const stop = fs.watch(changed)
  const inspect = () => Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)
  try {
    await inspect()
    expect(changed).not.toHaveBeenCalled()
    await app.vault.adapter.writeBinary(path, new TextEncoder().encode('saved externally').buffer)
    await inspect()
    expect(changed).not.toHaveBeenCalled()
    fs.completeInitialExchange()
    // The next exchanges are busy across every poll; successful startup is durable.
    for (let tick = 0; tick < 3; tick++) await inspect()
    expect(changed.mock.calls.flatMap(([paths]) => paths)).toContain(path)
    const found = await scan(fs, state, { excluded: () => false })
    expect(found.ops).toEqual([expect.objectContaining({ op: 'create', path })])
    const uploaded: Uint8Array[] = []
    await push(
      {
        hasBlob: async () => false,
        putBlob: async (_sha: string, bytes: Uint8Array) => {
          uploaded.push(bytes)
        },
        commitRaw: async (ops: CommitOp[]) => ({
          replayed: false,
          body: {
            head_seq: 1,
            results: ops.map((op) => ({
              status: 'applied',
              seq: 1,
              file_id: 'sample-file',
              version_id: 'sample-version',
              path: 'path' in op ? op.path : path,
              sha: 'sha' in op ? op.sha : null,
              size: 'size' in op ? op.size : 0,
              mtime: 'mtime' in op ? op.mtime : 0,
            })),
          },
        }),
      } as never,
      fs,
      state,
      found,
      { expected: new ExpectedWrites() }
    )
    expect(uploaded).toEqual([new TextEncoder().encode('saved externally')])
  } finally {
    stop()
  }
})

it('132 skips unreadable directories without starving settings or later discoveries', async () => {
  const app = buildFakeVault([
    { path: '.obsidian/app.json', content: '{}' },
    { path: 'Blocked/old.md', content: 'saved' },
    { path: 'Later/new.md', content: 'new' },
  ])
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  vi.spyOn(app.vault, 'getFiles').mockReturnValue([])
  const original = app.vault.adapter.list.bind(app.vault.adapter)
  let unreadable = true
  vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (path) => {
    if (path === 'Blocked' && unreadable)
      throw Object.assign(new Error('cannot list'), { code: 'EACCES' })
    return original(path)
  })
  const state = await tracked('Blocked/old.md', 'saved')
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  const changed = vi.fn()
  const stop = fs.watch(changed)
  const inspect = () => Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)
  try {
    await inspect()
    expect(changed.mock.calls.flatMap(([paths]) => paths)).toContain('Later/new.md')
    changed.mockClear()
    await app.vault.adapter.writeBinary(
      '.obsidian/app.json',
      new TextEncoder().encode('{"changed":true}').buffer
    )
    expect(await inspect()).toBe(true)
    const paths = changed.mock.calls.flatMap(([paths]) => paths)
    expect(paths).toContain('.obsidian/app.json')
    // The ordinary scanner remains conservative about unreadable tracked files.
    // Verification skipping a directory must not turn its ledger into absence.
    await expect(scan(fs, state, { excluded: () => false })).rejects.toThrow('cannot list Blocked')
    expect((await state.get('Blocked/old.md'))?.versionId).toBe('sample-version')
    unreadable = false
    expect((await Array.fromAsync(fs.list())).map((file) => file.path)).toContain('Later/new.md')
    expect(
      (await scan(fs, state, { excluded: () => false })).ops.some((op) => op.op === 'delete')
    ).toBe(false)
    expect(await inspect()).toBe(true)
  } finally {
    stop()
  }
})

it('132 resumes a 33000-file directory with bounded verification of committed files', async () => {
  const app = buildFakeVault([{ path: 'file-32999.md', content: 'new', mtime: 1000 }])
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  vi.spyOn(app.vault, 'getFiles').mockReturnValue([])
  const paths = Array.from({ length: 33000 }, (_, i) => `file-${i}.md`)
  const original = app.vault.adapter.list.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (path) =>
    path === '' ? { files: paths, folders: [] } : original(path)
  )
  const state = new MemoryStateStore()
  vi.spyOn(state, 'get').mockImplementation(async (path) =>
    path === 'file-32999.md'
      ? null
      : {
          path,
          wirePath: path,
          fileId: 'sample',
          versionId: 'saved',
          sha: 'digest',
          size: 1,
          mtime: 1,
        }
  )
  const originalStat = app.vault.adapter.stat.bind(app.vault.adapter)
  const stat = vi
    .spyOn(app.vault.adapter, 'stat')
    .mockImplementation(async (path) =>
      path.startsWith('file-') ? { type: 'file', size: 1, mtime: 1, ctime: 1 } : originalStat(path)
    )
  const changed = vi.fn()
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  const stop = fs.watch(changed)
  try {
    for (let i = 0; i < 260; i++) {
      const awaiting = Reflect.get(fs, 'awaitingIndex') as Set<string>
      const before = awaiting.size
      stat.mockClear()
      expect(await Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)).toBe(true)
      expect(awaiting.size - before).toBeLessThanOrEqual(256)
      expect(
        stat.mock.calls.filter(([path]) => path.startsWith('file-')).length
      ).toBeLessThanOrEqual(384)
    }
    expect(changed.mock.calls.flatMap(([paths]) => paths)).toContain('file-32999.md')
  } finally {
    stop()
  }
  // Full 33k metadata coverage takes longer than discovery-only enumeration.
  // Per-task timing remains enforced by the deterministic-clock regression.
}, 30000)

it('132 bounds metadata tasks and poll work with 33000 index-absent candidates including ledgered files', async () => {
  const app = buildFakeVault([])
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  const state = new MemoryStateStore()
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  const stop = fs.watch(() => {})
  const inspect = () => Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)
  try {
    await inspect()
    const candidates = Reflect.get(fs, 'unindexedFiles') as Set<string>
    for (let i = 0; i < 33000; i++) candidates.add(`Omitted/file-${i}.md`)
    let clock = 0
    let boundary = 0
    let longest = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const scheduler = {
      yield: vi.fn(async () => {
        longest = Math.max(longest, clock - boundary)
        boundary = clock
      }),
    }
    const previous = Object.getOwnPropertyDescriptor(window, 'scheduler')
    Object.defineProperty(window, 'scheduler', { configurable: true, value: scheduler })
    let stats = 0
    const original = app.vault.adapter.stat.bind(app.vault.adapter)
    const stat = vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
      if (path.startsWith('Omitted/')) {
        clock++
        stats++
        return { type: 'file', size: 1, mtime: 1, ctime: 1 }
      }
      return original(path)
    })
    try {
      await inspect()
      longest = Math.max(longest, clock - boundary)
      expect(longest).toBeLessThan(50)
      expect(stats).toBeLessThanOrEqual(384)
      expect(scheduler.yield).toHaveBeenCalled()
      vi.spyOn(state, 'get').mockImplementation(async (path) => ({
        path,
        wirePath: path,
        fileId: 'sample',
        versionId: 'saved',
        sha: 'digest',
        size: 1,
        mtime: 1,
      }))
      stats = 0
      boundary = clock
      longest = 0
      await inspect()
      longest = Math.max(longest, clock - boundary)
      expect(longest).toBeLessThan(50)
      expect(stats).toBeGreaterThan(0)
      expect(stats).toBeLessThanOrEqual(384)
    } finally {
      stat.mockRestore()
      now.mockRestore()
      if (previous) Object.defineProperty(window, 'scheduler', previous)
      else delete (window as Window & { scheduler?: unknown }).scheduler
    }
  } finally {
    stop()
  }
})

async function tracked(path: string, content = 'original') {
  const state = new MemoryStateStore()
  await state.put({
    path,
    wirePath: path,
    fileId: 'sample-file',
    versionId: 'sample-version',
    sha: await sha256(new TextEncoder().encode(content)),
    size: content.length,
    mtime: 1000,
  })
  return state
}

it('133 cancels an incomplete index without publishing absence and retries from the same ledger', async () => {
  const app = buildFakeVault([{ path: 'Notes/sample.md', content: 'original', mtime: 1000 }])
  let clean = false
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
  const state = await tracked('Notes/sample.md')
  const controller = new AbortController()
  const waiting = vi.fn()
  const make = (signal: AbortSignal) =>
    new ObsidianFileSystem(app as never, {
      prepareStartupInventory: async () => {},
      indexWaitSignal: () => signal,
      onIndexWait: waiting,
      ledger: state,
    })
  const list = vi.spyOn(app.vault.adapter, 'list')
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  const first = scan(make(controller.signal), state, { excluded: () => false })
  const rejected = expect(first).rejects.toThrow('sample shutdown')
  await vi.waitFor(() => expect(waiting).toHaveBeenCalledWith(true))
  controller.abort(new Error('sample shutdown'))
  await rejected
  expect(list).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
  expect((await state.get('Notes/sample.md'))?.versionId).toBe('sample-version')
  clean = true
  const restarted = await scan(make(new AbortController().signal), state, { excluded: () => false })
  expect(restarted.ops).toEqual([])
  expect(waiting).toHaveBeenLastCalledWith(false)
})

async function changedHiddenFile(path: string) {
  const app = buildFakeVault([{ path, content: 'original', mtime: 1000 }])
  const state = await tracked(path)
  expect(app.vault.getFiles().map((file) => file.path)).not.toContain(path)
  await app.vault.adapter.writeBinary(path, new TextEncoder().encode('new saved content').buffer, {
    mtime: 2000,
  })
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  const ignore = ignoreFor('.obsidian', null)
  const found = await scan(fs, state, { excluded: (path) => ignore.ignores(path) })
  expect(found.ops).toEqual([
    expect.objectContaining({
      op: 'modify',
      file_id: 'sample-file',
      sha: await sha256(new TextEncoder().encode('new saved content')),
    }),
  ])
  expect(await app.vault.adapter.read(path)).toBe('new saved content')
}

it('131 discovers a changed unindexed configuration file after restart', async () => {
  await changedHiddenFile('.obsidian/app.json')
})

it.each([true, false])(
  '131 excludes nested hidden files without inferring deletion, present=%s',
  async (present) => {
    const path = 'Notes/.hidden/sample.json'
    const app = buildFakeVault(present ? [{ path, content: 'local saved bytes', mtime: 2000 }] : [])
    const state = await tracked(path)
    const ignore = ignoreFor('.obsidian', null)
    expect(ignore.ignores(path)).toBe(true)
    const fs = new ObsidianFileSystem(app as never, { ledger: state })
    const found = await scan(fs, state, { excluded: (path) => ignore.ignores(path) })
    expect(found.ops).toEqual([])
    expect((await state.get(path))?.versionId).toBe('sample-version')
    if (present) expect(await app.vault.adapter.read(path)).toBe('local saved bytes')
    else expect(await app.vault.adapter.exists(path)).toBe(false)
  }
)

it('128 trusts an equal-size equal-mtime indexed replacement without reading content', async () => {
  const path = 'Notes/sample.md'
  const app = buildFakeVault([{ path, content: 'original', mtime: 1000 }])
  const state = await tracked(path)
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  await app.vault.adapter.writeBinary(path, new TextEncoder().encode('replaced').buffer, {
    mtime: 1000,
  })
  const fs = new ObsidianFileSystem(app as never, {
    ledger: state,
    prepareStartupInventory: async () => {},
  })
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  const found = await scan(fs, state, { excluded: () => false })
  expect(found.ops).toEqual([])
  expect(read).not.toHaveBeenCalled()
  expect((await state.get(path))?.sha).toBe(await sha256(new TextEncoder().encode('original')))
  expect(await app.vault.adapter.read(path)).toBe('replaced')
})

it('132 keeps a tracked host-excluded file eligible under the sync filter', async () => {
  const path = 'Excluded/sample.md'
  const app = buildFakeVault([{ path, content: 'original', mtime: 1000 }])
  const state = await tracked(path)
  vi.spyOn(app.vault, 'getFiles').mockReturnValue([])
  await app.vault.adapter.writeBinary(
    path,
    new TextEncoder().encode('changed outside the host index').buffer,
    { mtime: 2000 }
  )
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  const found = await scan(fs, state, { excluded: () => false })
  expect(found.ops).toEqual([
    expect.objectContaining({
      op: 'modify',
      file_id: 'sample-file',
      sha: await sha256(new TextEncoder().encode('changed outside the host index')),
    }),
  ])
  expect((await state.get(path))?.versionId).toBe('sample-version')
})

it('132 discovers a new host-excluded file without a prior ledger entry', async () => {
  const path = 'Excluded/sample.md'
  const app = buildFakeVault([{ path, content: 'new saved content', mtime: 1000 }])
  const externalWrite = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  vi.spyOn(app.vault, 'getFiles').mockReturnValue([])
  const state = new MemoryStateStore()
  const ignore = ignoreFor('.obsidian', null)
  expect(ignore.ignores(path)).toBe(false)
  const fs = new ObsidianFileSystem(app as never, {
    ledger: state,
    prepareStartupInventory: async () => {},
  })
  const changed = vi.fn()
  const stop = fs.watch(changed)
  try {
    // Startup remains index-only. The next verification poll must discover the
    // ordinary disk file even though no index event or ledger entry names it.
    await Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)
    const found = await scan(fs, state, { excluded: (path) => ignore.ignores(path) })
    expect(found.ops).toEqual([expect.objectContaining({ op: 'create', path })])
    expect(changed.mock.calls.flatMap(([paths]) => paths)).toContain(path)
    const uploaded: Uint8Array[] = []
    const client = {
      hasBlob: async () => false,
      putBlob: async (_sha: string, bytes: Uint8Array) => {
        uploaded.push(bytes)
      },
      commitRaw: async (ops: CommitOp[]) => ({
        replayed: false,
        body: {
          head_seq: 1,
          results: ops.map((op) => ({
            status: 'applied',
            seq: 1,
            file_id: 'sample-file',
            version_id: 'sample-version',
            path: 'path' in op ? op.path : path,
            sha: 'sha' in op ? op.sha : null,
            size: 'size' in op ? op.size : 0,
            mtime: 'mtime' in op ? op.mtime : 0,
          })),
        },
      }),
    }
    await push(client as never, fs, state, found, { expected: new ExpectedWrites() })
    expect(uploaded).toEqual([new TextEncoder().encode('new saved content')])
    expect((await state.get(path))?.versionId).toBe('sample-version')
    expect((await scan(fs, state, { excluded: (path) => ignore.ignores(path) })).ops).toEqual([])
    // Run the post-upload poll that previously retired the discovery candidate.
    await Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)
    changed.mockClear()
    // Mutate the raw backing disk: an external app emits neither a vault event
    // nor an observed adapter write, and the host index still omits this file.
    await externalWrite(path, new TextEncoder().encode('external edit after upload').buffer, {
      mtime: 2000,
    })
    expect(changed).not.toHaveBeenCalled()
    await Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)
    expect(changed.mock.calls.flatMap(([paths]) => paths)).toContain(path)
    expect((await scan(fs, state, { excluded: (path) => ignore.ignores(path) })).ops).toEqual([
      expect.objectContaining({
        op: 'modify',
        sha: await sha256(new TextEncoder().encode('external edit after upload')),
      }),
    ])
  } finally {
    stop()
  }
})

it.each(['.obsidian', 'Settings'])(
  '132 bounds each verification poll and eventually discovers files beyond its first directory batch (%s configuration)',
  async (configDir) => {
    const specs = Array.from({ length: 40 }, (_, i) => ({
      path: `Folder-${i}/sample.md`,
      content: 'saved',
      mtime: 1000,
    }))
    const app = buildFakeVault([...specs, { path: configDir + '/app.json', content: '{}' }])
    app.vault.configDir = configDir
    Object.assign(app.workspace, { layoutReady: true })
    Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
    vi.spyOn(app.vault, 'getFiles').mockReturnValue([])
    const fs = new ObsidianFileSystem(app as never, {
      ledger: new MemoryStateStore(),
      prepareStartupInventory: async () => {},
    })
    const list = vi.spyOn(app.vault.adapter, 'list')
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    expect((await Array.fromAsync(fs.list())).map((file) => file.path)).toEqual([
      configDir + '/app.json',
    ])
    expect(list.mock.calls.filter(([path]) => !path.startsWith(configDir))).toEqual([])
    const stop = fs.watch(() => {})
    try {
      for (let i = 0; i < 6; i++) {
        const before = list.mock.calls.filter(([path]) => !path.startsWith(configDir)).length
        const configBefore = list.mock.calls.filter(([path]) => path === configDir).length
        await Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)
        const after = list.mock.calls.filter(([path]) => !path.startsWith(configDir)).length
        expect(after - before).toBeLessThanOrEqual(8)
        // The existing settings snapshot owns this tree. Ordinary verification must
        // not add a second configuration traversal in the same poll.
        expect(list.mock.calls.filter(([path]) => path === configDir).length - configBefore).toBe(1)
      }
      expect(read).not.toHaveBeenCalled()
      const paths = (await Array.fromAsync(fs.list())).map((file) => file.path)
      expect(paths.sort()).toEqual(
        [...specs.map((file) => file.path), configDir + '/app.json'].sort()
      )
    } finally {
      stop()
    }
  }
)

it('132 confines verification to a folder connection and leaves hidden neighbors alone', async () => {
  const app = buildFakeVault([
    { path: 'Shared/sample.md', content: 'saved' },
    { path: 'Shared/.private/sample.md', content: 'hidden' },
    { path: 'Private/sample.md', content: 'private' },
  ])
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  const fs = new ObsidianFileSystem(app as never, {
    fileScope: 'Shared',
    prepareStartupInventory: async () => {},
  })
  const list = vi.spyOn(app.vault.adapter, 'list')
  const globalIndex = vi.spyOn(app.vault, 'getFiles')
  const stop = fs.watch(() => {})
  try {
    await Reflect.get(fs, Symbol.for('abele.sync.inspect-polled-v1')).call(fs)
    expect(list.mock.calls.map(([path]) => path)).toEqual(['Shared'])
    expect(globalIndex).not.toHaveBeenCalled()
  } finally {
    stop()
  }
})

it('126/129 discards a partial rebuild inventory and sends only the latest indexed edit', async () => {
  const path = 'Notes/sample.md'
  const app = buildFakeVault([{ path, content: 'original', mtime: 1000 }])
  const state = await tracked(path)
  let clean = true
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
  const indexed = app.vault.getFiles.bind(app.vault)
  vi.spyOn(app.vault, 'getFiles')
    .mockImplementationOnce(() => {
      clean = false
      return []
    })
    .mockImplementation(indexed)
  const waiting = vi.fn()
  const controller = new AbortController()
  const fs = new ObsidianFileSystem(app as never, {
    ledger: state,
    prepareStartupInventory: async () => {},
    indexWaitSignal: () => controller.signal,
    onIndexWait: waiting,
  })
  const list = vi.spyOn(app.vault.adapter, 'list')
  const reading = scan(fs, state, { excluded: () => false })
  try {
    await vi.waitFor(() => expect(waiting).toHaveBeenCalledWith(true))
    expect(list).not.toHaveBeenCalled()
    expect((await state.get(path))?.versionId).toBe('sample-version')
    await app.vault.adapter.writeBinary(
      path,
      new TextEncoder().encode('latest saved edit').buffer,
      { mtime: 2000 }
    )
    clean = true
    const found = await reading
    expect(found.ops).toEqual([
      expect.objectContaining({
        op: 'modify',
        file_id: 'sample-file',
        sha: await sha256(new TextEncoder().encode('latest saved edit')),
      }),
    ])
  } finally {
    controller.abort(new Error('sample teardown'))
    await reading.catch(() => {})
  }
})
