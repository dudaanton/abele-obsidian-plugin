import { expect, it, vi } from 'vitest'
import {
  MemoryFileSystem,
  MemoryStateStore,
  ExpectedWrites,
  sha256,
  resumeJournal,
  EngineError,
  V2EngineClient,
} from '@abele/sync-sdk/core'
import { PullPlacer } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullPlace.js'
import { PathCoordinator, coordinatedFileSystem } from '@/sync/pathCoordinator'
import { deferred } from '../helpers/deferred'
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { JOURNAL_KEY, RECOVERED_WRITES_KEY } from '@/sync/writeJournal'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(
  ['complete', 'edited', 'offline'].flatMap((outcome) =>
    [false, true].map((staged) => ({ outcome, staged }))
  )
)(
  'streams once outside the path lease and settles a slow pull: $outcome, staged=$staged',
  async ({ outcome, staged }) => {
    const app = buildFakeVault([]),
      disk = new ObsidianFileSystem(app as never),
      state = new MemoryStateStore(),
      locks = new PathCoordinator(),
      bytes = staged
        ? new Uint8Array(1024 * 1024 + 1).fill(17)
        : new TextEncoder().encode('incoming sample'),
      sha = await sha256(bytes),
      downloading = deferred<void>(),
      release = deferred<void>()
    if (staged)
      Object.defineProperty(disk, Symbol.for('abele.sync.replay-stage-v1'), {
        configurable: true,
        value: async () => true,
      })
    const staging = vi.spyOn(disk, 'beginAtomicWrite')
    const source = {
      size: bytes.length,
      read: vi.fn(async (offset: number, length: number) => {
        downloading.resolve()
        await release.promise
        if (outcome === 'offline') throw new EngineError('offline', 'Sample source unavailable')
        return bytes.slice(offset, offset + length)
      }),
      assertUnchanged: async () => {},
      close: vi.fn(async () => {}),
    }
    const getBlob = vi.fn(async () => bytes)
    const openVersion = vi.fn(async () => source)
    const placer = new PullPlacer(
      { getBlob, openVersion },
      coordinatedFileSystem(disk, locks),
      state,
      { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
      sha256
    )
    const change: ChangeItem = {
      seq: 1,
      file_id: 'sample-file',
      version_id: 'sample-version',
      path: 'Shared/sample.md',
      prev_path: null,
      op: 'create',
      kind: 'note',
      sha,
      size: bytes.length,
      mtime: 10,
      at: '2025-01-01T00:00:00Z',
      actor: { kind: 'system', id: 'sample', name: 'Sample' },
    }
    const placement = placer.place(change, sha, null, new Map(), new Map()).then(
      (result) => result,
      (error: unknown) => error
    )
    await downloading.promise
    let entered = false
    const other = locks.run([change.path], async () => {
      entered = true
      if (outcome === 'edited') {
        await app.vault.adapter.mkdir('Shared')
        await app.vault.adapter.write(change.path, 'local sample')
      }
    })
    try {
      await vi.waitFor(() => expect(entered).toBe(true), { timeout: 100 })
    } finally {
      release.resolve()
      await other
    }
    const result = await placement
    expect(
      staging.mock.calls.some(([path]) => path.startsWith('.abele-sync/placement-inbox/'))
    ).toBe(staged)
    expect(getBlob).not.toHaveBeenCalled()
    expect(openVersion).toHaveBeenCalledTimes(1)
    expect(source.read).toHaveBeenCalledTimes(
      outcome === 'offline' ? 1 : Math.ceil(bytes.length / (1024 * 1024))
    )
    expect(source.close).toHaveBeenCalled()
    expect(app.loadLocalStorage(JOURNAL_KEY) ?? []).toEqual([])
    if (outcome === 'complete') {
      expect(result).toBe(true)
      expect(await disk.read(change.path)).toEqual(bytes)
      expect((await state.get(change.path))?.sha).toBe(sha)
    } else {
      expect(await state.get(change.path)).toBeNull()
      if (outcome === 'edited') {
        expect(result).toBe(false)
        expect(await app.vault.adapter.read(change.path)).toBe('local sample')
      } else {
        expect(result).toMatchObject({ code: 'offline' })
        expect(await disk.stat(change.path)).toBeNull()
      }
    }
  }
)

it.each([
  'empty',
  'complete',
  'complete-medium',
  'restart',
  'restart-sealed',
  'published-restart',
  'published-restart-twice',
  'published-restart-edited',
  'published-move',
  'published-move-case',
  'published-move-recreated',
  'published-update-partial',
  'published-restart-small',
  'shrink',
  'corrupt',
])(
  'streams a large pull without local reads: %s',
  async (outcome) => {
    const app = buildFakeVault([])
    const nativeRead = app.vault.adapter.readBinary.bind(app.vault.adapter)
    app.vault.adapter.appendBinary = async (path: string, data: ArrayBuffer) => {
      const before = new Uint8Array(await nativeRead(path))
      const joined = new Uint8Array(before.length + data.byteLength)
      joined.set(before)
      joined.set(new Uint8Array(data), before.length)
      await app.vault.adapter.writeBinary(path, joined.buffer)
    }
    let disk = new ObsidianFileSystem(app as never)
    const state = new MemoryStateStore()
    const size =
      outcome === 'empty'
        ? 0
        : outcome === 'published-restart-small'
          ? 1024
          : (outcome === 'complete-medium' ? 2 : 50) * 1024 * 1024 + 1
    const bytes = new Uint8Array(size).fill(17)
    const sha = await sha256(bytes)
    let retainedSha = sha
    const getBlob = vi.fn(async () => {
      throw new Error('Whole download forbidden')
    })
    let interrupted = outcome.startsWith('restart')
    const reads: { offset: number; length: number }[] = []
    const client = new V2EngineClient(
      encodeAccessToken({
        v: 1,
        address: 'https://sync.example.invalid',
        key: 'a'.repeat(43),
        scope: { kind: 'folder', id: 'sample-root', path: '/' },
      }),
      {
        fetch: async (_input, init) => {
          const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '')
          expect(range).not.toBeNull()
          const offset = Number(range![1]),
            length = Number(range![2]) - offset + 1
          expect(length).toBeLessThanOrEqual(1024 * 1024)
          reads.push({ offset, length })
          const chunk = bytes.slice(offset, offset + length)
          if (outcome === 'corrupt' && offset === 0) chunk[0] ^= 1
          return new Response(chunk, {
            status: 206,
            headers: { 'content-range': `bytes ${offset}-${offset + length - 1}/${size}` },
          })
        },
      }
    )
    const openVersion = vi.fn(async () => ({
      ...(await client.openVersion('sample-file', 'sample-version', { size, sha })),
      assertUnchanged: async () => {
        if (interrupted) throw new EngineError('offline', 'Sample interrupted transfer')
      },
    }))
    const wholeRead = vi
      .spyOn(app.vault.adapter, 'readBinary')
      .mockRejectedValue(new Error('Whole local read forbidden'))
    const placer = () =>
      new PullPlacer(
        { getBlob, openVersion },
        coordinatedFileSystem(disk, new PathCoordinator()),
        state,
        { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
        sha256
      )
    const change: ChangeItem = {
      seq: 1,
      file_id: 'sample-file',
      version_id: 'sample-version',
      path: 'Shared/sample.bin',
      prev_path: null,
      op: 'create',
      kind: 'attachment',
      sha,
      size,
      mtime: 10,
      at: '2025-01-01T00:00:00Z',
      actor: { kind: 'system', id: 'sample', name: 'Sample' },
    }
    if (outcome.startsWith('published-move') || outcome === 'published-update-partial') {
      expect(await placer().place(change, sha, null, new Map(), new Map())).toBe(true)
      const entry = await state.get(change.path)
      const updating = outcome === 'published-update-partial'
      if (updating) bytes[0] ^= 1
      const incomingSha = updating ? await sha256(bytes) : sha
      const moved: ChangeItem = {
        ...change,
        path: updating
          ? change.path
          : outcome === 'published-move-case'
            ? 'Shared/SAMPLE.bin'
            : 'Shared/renamed.bin',
        prev_path: updating ? null : change.path,
        op: updating ? 'modify' : 'move',
        sha: incomingSha,
        version_id: 'sample-moved',
      }
      if (!updating)
        vi.spyOn(state, 'transaction').mockRejectedValueOnce(
          new Error('Sample move killed after publication')
        )
      interrupted = updating
      await expect(placer().place(moved, incomingSha, entry, new Map(), new Map())).rejects.toThrow(
        updating ? 'interrupted' : 'killed'
      )
      app.vault.adapter = new Proxy(app.vault.adapter, {})
      disk = new ObsidianFileSystem(app as never)
      await disk.recover()
      interrupted = false
      openVersion.mockClear()
      reads.length = 0
      expect(await placer().adopt(moved, entry)).toBe(false)
      if (outcome === 'published-move-recreated') {
        await app.vault.adapter.write(change.path, 'independent recreated source')
        expect(await placer().place(moved, incomingSha, entry, new Map(), new Map())).toBe(false)
        expect(new TextDecoder().decode(await nativeRead(change.path))).toBe(
          'independent recreated source'
        )
        expect(openVersion).not.toHaveBeenCalled()
        return
      }
      expect(await placer().place(moved, incomingSha, entry, new Map(), new Map())).toBe(true)
      if (!updating) expect(await state.get(change.path)).toBeNull()
      expect((await state.get(moved.path))?.versionId).toBe(moved.version_id)
      expect(openVersion).toHaveBeenCalledTimes(1)
      expect(wholeRead).not.toHaveBeenCalled()
      expect(reads.map((one) => one.offset)).toEqual(
        Array.from({ length: Math.ceil(size / (1024 * 1024)) }, (_, i) => i * 1024 * 1024)
      )
      return
    }
    if (outcome.startsWith('published-restart')) {
      vi.spyOn(state, 'transaction').mockRejectedValueOnce(
        new Error('Sample process killed after publication')
      )
      await expect(placer().place(change, sha, null, new Map(), new Map())).rejects.toThrow(
        'killed'
      )
      expect(await disk.stat(change.path)).toMatchObject({ size })
      if (outcome === 'published-restart-edited' || outcome === 'published-restart-small') {
        const local =
          outcome === 'published-restart-small'
            ? new Uint8Array(2 * 1024 * 1024).fill(33)
            : new TextEncoder().encode('independent local edit after publication')
        await app.vault.adapter.writeBinary(change.path, local.buffer, { mtime: 99 })
        retainedSha = await sha256(local)
      }
      app.vault.adapter = new Proxy(app.vault.adapter, {})
      disk = new ObsidianFileSystem(app as never)
      await disk.recover()
      if (outcome === 'published-restart-twice') {
        interrupted = true
        await expect(placer().place(change, sha, null, new Map(), new Map())).rejects.toThrow(
          'interrupted'
        )
        app.vault.adapter = new Proxy(app.vault.adapter, {})
        disk = new ObsidianFileSystem(app as never)
        await disk.recover()
        interrupted = false
      }
      openVersion.mockClear()
      reads.length = 0
    }
    if (interrupted) {
      await expect(placer().place(change, sha, null, new Map(), new Map())).rejects.toThrow(
        'interrupted'
      )
      if (outcome === 'restart-sealed') {
        const [entry] = app.loadLocalStorage(JOURNAL_KEY) as { temp: string }[]
        await (await disk.reopenStage(entry.temp)).seal({ size, sha })
      }
      // A fresh adapter identity models a new process: no incremental receipt survives.
      app.vault.adapter = new Proxy(app.vault.adapter, {})
      disk = new ObsidianFileSystem(app as never)
      await disk.recover()
      interrupted = false
      openVersion.mockClear()
      reads.length = 0
    }
    const rename = vi.spyOn(app.vault.adapter, 'rename')
    if (outcome === 'corrupt') {
      await expect(placer().place(change, sha, null, new Map(), new Map())).rejects.toThrow(
        'integrity'
      )
      expect(rename).not.toHaveBeenCalled()
      expect(await disk.stat(change.path)).toBeNull()
      expect(await state.get(change.path)).toBeNull()
      return
    }
    expect(await placer().place(change, sha, null, new Map(), new Map())).toBe(true)
    expect(openVersion).toHaveBeenCalledTimes(1)
    expect(getBlob).not.toHaveBeenCalled()
    expect(wholeRead).not.toHaveBeenCalled()
    expect(reads).toHaveLength(Math.ceil(size / (1024 * 1024)))
    expect(reads.map((one) => one.offset)).toEqual(reads.map((_, i) => i * 1024 * 1024))
    // This host cannot rehash installed bytes; only the pull's live receipt can verify them.
    if (size)
      expect(await disk[Symbol.for('abele.sync.fingerprint-pull-v1')](change.path)).toMatchObject({
        size,
        sha,
      })
    else expect(await disk.stat(change.path)).toMatchObject({ size: 0 })
    expect((await state.get(change.path))?.sha).toBe(sha)
    expect(app.loadLocalStorage(JOURNAL_KEY) ?? []).toEqual([])
    if (outcome.startsWith('published-restart')) {
      const retained = app.loadLocalStorage(RECOVERED_WRITES_KEY) as { backup: string }[]
      expect(retained).toHaveLength(1)
      expect(await sha256(new Uint8Array(await nativeRead(retained[0].backup)))).toBe(retainedSha)
    }
    if (outcome === 'shrink') {
      const replacement = new Uint8Array(1024).fill(31),
        replacementSha = await sha256(replacement)
      const entry = await state.get(change.path)
      const atomic = vi.spyOn(disk, 'writeAtomic')
      const shrinking = new PullPlacer(
        {
          getBlob,
          openVersion: async () => ({
            size: replacement.length,
            read: async (offset: number, length: number) =>
              replacement.slice(offset, offset + length),
            assertUnchanged: async () => {},
            close: async () => {},
          }),
        },
        coordinatedFileSystem(disk, new PathCoordinator()),
        state,
        { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
        sha256
      )
      expect(
        await shrinking.place(
          {
            ...change,
            version_id: 'sample-next',
            size: replacement.length,
            sha: replacementSha,
            mtime: 20,
          },
          replacementSha,
          entry,
          new Map(),
          new Map()
        )
      ).toBe(true)
      expect(atomic).not.toHaveBeenCalled()
      expect(wholeRead).not.toHaveBeenCalled()
      expect(await disk[Symbol.for('abele.sync.fingerprint-pull-v1')](change.path)).toMatchObject({
        size: replacement.length,
        sha: replacementSha,
      })
    }
  },
  20000
)

it('downloads a same-hash move with a missing local baseline before acquiring either path', async () => {
  const disk = new MemoryFileSystem(),
    state = new MemoryStateStore(),
    locks = new PathCoordinator(),
    bytes = new TextEncoder().encode('sample'),
    sha = await sha256(bytes)
  const entry = {
    path: 'old.md',
    wirePath: 'old.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha,
    size: bytes.length,
    mtime: 10,
  }
  await state.put(entry) // The ledger survived, but its local file did not.
  const downloading = deferred<void>(),
    release = deferred<void>()
  const placer = new PullPlacer(
    {
      getBlob: async () => {
        downloading.resolve()
        await release.promise
        return bytes
      },
    },
    coordinatedFileSystem(disk, locks),
    state,
    { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
    sha256
  )
  const change: ChangeItem = {
    seq: 1,
    file_id: entry.fileId,
    version_id: 'moved',
    path: 'new.md',
    prev_path: entry.path,
    op: 'move',
    kind: 'note',
    sha,
    size: bytes.length,
    mtime: 10,
    at: '2025-01-01T00:00:00Z',
    actor: { kind: 'system', id: 'sample', name: 'Sample' },
  }
  const placement = placer.place(change, sha, entry, new Map(), new Map())
  await downloading.promise
  let entered = false
  const other = locks.run(['old.md', 'new.md'], async () => {
    entered = true
  })
  try {
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 100 })
  } finally {
    release.resolve()
    await Promise.all([placement, other])
  }
  expect(await disk.read('new.md')).toEqual(bytes)
})

it('does not reserve any placement path during later bounded push download runs', async () => {
  const disk = new MemoryFileSystem(),
    state = new MemoryStateStore(),
    locks = new PathCoordinator()
  const original = new TextEncoder().encode('original'),
    incoming = new TextEncoder().encode('incoming')
  const sha = await sha256(original),
    remoteSha = await sha256(incoming)
  for (const name of ['one', 'two']) {
    await disk.writeAtomic(name + '.md', original, 10)
    await state.put({
      path: name + '.md',
      wirePath: name + '.md',
      fileId: name,
      versionId: 'base',
      sha,
      size: original.length,
      mtime: 10,
    })
  }
  await state.setJournal({
    batchId: 'sample-batch',
    idempotencyKey: 'sample-request',
    startedAt: new Date().toISOString(),
    ops: ['one', 'two'].map((name) => ({
      op: 'modify',
      file_id: name,
      base_version_id: 'base',
      sha,
      size: original.length,
      mtime: 10,
    })),
  })
  const downloading = deferred<void>(),
    release = deferred<void>()
  let calls = 0
  const client = {
    hasBlob: async () => true,
    getBlob: async () => {
      if (++calls === 2) {
        downloading.resolve()
        await release.promise
      }
      return incoming
    },
    commitRaw: async () => ({
      replayed: true,
      body: {
        head_seq: 2,
        results: ['one', 'two'].map((name) => ({
          status: 'merged',
          file_id: name,
          version_id: 'received-' + name,
          path: name + '.md',
          sha: remoteSha,
          size: incoming.length,
          mtime: 20,
        })),
      },
    }),
  }
  const pending = resumeJournal(client as never, coordinatedFileSystem(disk, locks), state, {
    expected: new ExpectedWrites(),
    prefetchBytes: 1,
  })
  await downloading.promise
  let entered = false
  const other = locks.run(['one.md'], async () => {
    entered = true
  })
  try {
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 100 })
  } finally {
    release.resolve()
    await Promise.all([pending, other])
  }
  expect(await state.getJournal()).toBeNull()
  expect(await disk.read('two.md')).toEqual(incoming)
})
