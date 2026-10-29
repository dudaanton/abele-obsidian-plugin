// @vitest-environment node
import '../helpers/desktopRequire'
import { IDBFactory, IDBKeyRange, IDBObjectStore, IDBDatabase } from 'fake-indexeddb'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { expect, it, vi } from 'vitest'
import { promises as disk } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ignoreFor } from '@/sync/scope'
import { buildFakeVault } from '../helpers/fakeVault'

it('preserves indexed change time across a state store restart', async () => {
  const factory = new IDBFactory()
  const entry = {
    path: 'Sample/entry.md',
    wirePath: 'Sample/entry.md',
    fileId: 'sample-entry',
    versionId: 'sample-version',
    sha: 'sample-hash',
    size: 4,
    mtime: 12,
    ctime: 34,
  }
  const first = await IndexedDbStateStore.open(factory, 'sample-change-time')
  await first.put(entry)
  first.close()
  const reopened = await IndexedDbStateStore.open(factory, 'sample-change-time')
  expect(await reopened.get(entry.path)).toEqual(entry)
  expect(await Array.fromAsync(reopened.all())).toEqual([entry])
  reopened.close()
})

it('resumes a crashed 33000-file native upload with durable IndexedDB and real task scheduling', async () => {
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
  const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-first-upload-')))
  // A root file precedes the recursive directory walk, making the interruption
  // occur before the rest of the tree independently of filesystem folder ordering.
  const target = 'Shared/Sample.bin'
  const paths = [
    target,
    ...Array.from(
      { length: 32999 },
      (_, i) => `Shared/Notes/Section ${i % 31}/层 ${i % 7}/Nested ${i % 13}/Sample ${i}.md`
    ),
  ]
  const factory = new IDBFactory()
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  let state: MemoryStateStore | IndexedDbStateStore = new MemoryStateStore()
  const durable = await IndexedDbStateStore.open(factory, 'sample-crash-resume')
  let runtime: TokenEngineRuntime | undefined
  const awaits: { name: string; ms: number; at: number }[] = []
  let lastIO = 0,
    activeIO = 0,
    maxIdleGap = 0
  const activity = () => {
    const now = performance.now()
    if (!activeIO && lastIO) maxIdleGap = Math.max(maxIdleGap, now - lastIO)
    lastIO = now
  }
  const beginIO = () => {
    activity()
    activeIO++
    let finished = false
    return () => {
      if (finished) return
      finished = true
      activeIO--
      lastIO = performance.now()
    }
  }
  const transaction = IDBDatabase.prototype.transaction
  const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    ...args
  ) {
    const finish = beginIO()
    try {
      const tx = transaction.apply(this, args)
      tx.addEventListener('complete', finish)
      tx.addEventListener('abort', finish)
      return tx
    } catch (error) {
      finish()
      throw error
    }
  })
  const native = new Proxy(disk, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      return async (...args: unknown[]) => {
        const finish = beginIO()
        try {
          return await Reflect.apply(value, target, args)
        } finally {
          finish()
        }
      }
    },
  })
  const spies = (['get', 'getAll', 'getAllKeys', 'put'] as const).map((key) => {
    const original = IDBObjectStore.prototype[key]
    return vi.spyOn(IDBObjectStore.prototype, key).mockImplementation(function (
      this: IDBObjectStore,
      ...args: unknown[]
    ) {
      activity()
      const request = Reflect.apply(original, this, args)
      request.addEventListener('success', activity)
      return request
    })
  })
  try {
    for (const folder of new Set(paths.map(dirname)))
      await disk.mkdir(join(root, folder), { recursive: true })
    const handle = await disk.open(join(root, target), 'wx')
    await handle.truncate(192 * 1024 * 1024)
    await handle.close()
    for (let offset = 1; offset < paths.length; offset += 64)
      await Promise.all(
        paths
          .slice(offset, offset + 64)
          .map((path) => disk.writeFile(join(root, path), 'sample ' + path))
      )
    const app = buildFakeVault(
      paths.map((path) => ({ path, content: 'sample', mtime: 1000 })),
      { sensitiveNames: true }
    )
    Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: native,
      stat: async (path: string) => {
        try {
          const info = await disk.stat(join(root, path))
          return {
            type: info.isDirectory() ? 'folder' : 'file',
            size: info.size,
            mtime: info.mtimeMs,
            ctime: info.birthtimeMs,
          }
        } catch (error) {
          if ((error as { code: string }).code === 'ENOENT') return null
          throw error
        }
      },
      list: async (path: string) => {
        const rows = await disk.readdir(join(root, path), { withFileTypes: true })
        return {
          files: rows
            .filter((one) => one.isFile())
            .map((one) => [path, one.name].filter(Boolean).join('/')),
          folders: rows
            .filter((one) => one.isDirectory())
            .map((one) => [path, one.name].filter(Boolean).join('/')),
        }
      },
    })
    const scope = { kind: 'folder' as const, id: 'sample-root', path: 'Shared' }
    let fresh = 0,
      firstPayloadMs = Infinity,
      hashesAtPayload = Infinity,
      started = 0
    let offline = false,
      resumed = false,
      parts = 0,
      firstResumeMs = Infinity,
      cursor = 1
    let acknowledged = 0,
      resumedHeads = 0
    const wire: { path: string; ms: number }[] = []
    const present = new Set<string>()
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      activity()
      if (offline) throw new TypeError('sample interrupted multipart')
      const path = new URL(String(input)).pathname
      if (resumed && !Number.isFinite(firstResumeMs))
        wire.push({ path, ms: performance.now() - started })
      if (path === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 200 * 1024 * 1024, quota_bytes: null },
        })
      if (path === '/v2/commit') {
        const { ops } = JSON.parse(String(init?.body))
        return Response.json({
          cursor: ++cursor,
          results: ops.map((op: { path: string; sha?: string; size?: number; mtime?: number }) => ({
            status: 'applied',
            file_id: crypto.randomUUID(),
            version_id: crypto.randomUUID(),
            seq: cursor,
            path: op.path,
            sha: op.sha ?? null,
            size: op.size ?? 0,
            mtime: op.mtime ?? 0,
          })),
        })
      }
      if (path.startsWith('/v2/uploads/') && init?.method === 'HEAD') {
        if (resumed) resumedHeads++
        return new Response(null, { status: present.has(path.split('/')[3]!) ? 200 : 404 })
      }
      if (path.endsWith('/complete')) {
        const sha = path.split('/')[3]!
        present.add(sha)
        acknowledged++
        return Response.json({ sha, size: 192 * 1024 * 1024 })
      }
      if (path.endsWith('/begin')) {
        const { size, max_part_bytes } = JSON.parse(String(init?.body))
        return Response.json({
          upload_id: 'sample-upload',
          part_size: max_part_bytes,
          parts: Math.ceil(size / max_part_bytes),
          received: resumed ? [0] : [],
        })
      }
      if (path.startsWith('/v2/uploads/') && init?.method === 'PUT') {
        if (!Number.isFinite(firstPayloadMs)) {
          firstPayloadMs = performance.now() - started
          hashesAtPayload = fresh
          console.log('native first payload', {
            firstPayloadMs,
            hashesAtPayload,
            active: Reflect.get(runtime!, 'scanUploads').size,
          })
        }
        if (resumed) {
          firstResumeMs = performance.now() - started
          throw new TypeError('sample resumed upload boundary')
        }
        if (path.includes('/sample-upload/')) parts++
        if (!path.includes('/sample-upload/')) {
          if (acknowledged >= 32700) {
            offline = true
            throw new TypeError('sample process loss')
          }
          acknowledged++
          present.add(path.split('/')[3]!)
        }
        return new Response(null, { status: 204 })
      }
      return Response.json({ items: [], cursor, next: null })
    })
    const open = () => {
      const fs = new ObsidianFileSystem(app as never, {
        ledger: state,
        connectionId: 'sample-connection',
        fileScope: 'Shared',
      })
      const fingerprint = Reflect.get(fs, 'fingerprintFresh').bind(fs)
      Object.assign(fs, {
        fingerprintFresh: async (...args: unknown[]) => {
          fresh++
          return fingerprint(...args)
        },
      })
      const metadata = new MemoryStateStore()
      return new TokenEngineRuntime({
        id: 'sample-connection',
        state,
        fs,
        encoded: encodeAccessToken({
          v: 1,
          address: 'https://sync.example.invalid',
          key: 'a'.repeat(43),
          scope,
        }),
        fetch: transport,
        changed: () => {},
        failed: () => {},
        covers: async () => false,
        scopeInput: async () => ({ key: 'sample-scope', ignore: ignoreFor('.obsidian', null) }),
        reviews: {
          executables: new ExecutableReview(metadata),
          attachments: new AttachmentConsent(metadata),
          close: () => {},
        },
      })
    }
    runtime = open()
    started = performance.now()
    await expect(runtime.sync()).rejects.toMatchObject({ code: 'offline' })
    console.log('native interruption', { fresh, parts })
    expect(parts).toBeGreaterThan(1)
    expect(hashesAtPayload).toBeLessThanOrEqual(2)
    expect(fresh).toBeLessThan(33000)
    const initialFresh = fresh
    await runtime.close()
    offline = false
    resumed = true
    // Prior applied feed pages retain false departure overrides in a linked index.
    // Populate the durable shape in one native transaction, outside restart timing.
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open('sample-crash-resume', 3)
      request.onsuccess = () => resolve(request.result)
    })
    const savedCursor = await state.getCursor()
    const savedEntries = []
    for await (const entry of state.all()) savedEntries.push(entry)
    expect(savedEntries).toEqual([])
    const seed = db.transaction(['meta', 'entries', 'pathCandidates'], 'readwrite')
    const seeded = new Promise<void>((resolve, reject) => {
      seed.oncomplete = () => resolve()
      seed.onabort = () => reject(seed.error)
    })
    for (const [key, value] of Reflect.get(state, 'meta') as Map<string, string>)
      seed.objectStore('meta').put({ key: 'plugin:' + key, value })
    seed.objectStore('meta').put({ key: 'cursor', value: savedCursor })
    for (const prefix of ['v2-departure-path:', 'v2-authored-departure-path:']) {
      seed.objectStore('meta').put({
        key: 'plugin:' + prefix + 'index',
        value: JSON.stringify({ first: paths[0], last: paths.at(-1) }),
      })
      paths.forEach((path, i) =>
        seed.objectStore('meta').put({
          key: 'plugin:' + prefix + 'p:' + encodeURIComponent(path),
          value: JSON.stringify({ present: false, next: paths[i + 1] ?? null }),
        })
      )
    }
    await seeded
    db.close()
    durable.close()
    spies.forEach((spy) => spy.mockClear())
    started = performance.now()
    lastIO = started
    maxIdleGap = 0
    expect(activeIO).toBe(0)
    const openAt = performance.now()
    const finishOpen = beginIO()
    try {
      state = await IndexedDbStateStore.open(factory, 'sample-crash-resume')
    } finally {
      finishOpen()
      awaits.push({ name: 'state.open', at: openAt - started, ms: performance.now() - openAt })
    }
    for (const name of ['metadataKeys', 'pluginMeta', 'getMeta', 'transaction'] as const) {
      const original = (state as IndexedDbStateStore)[name].bind(state)
      Object.assign(state, {
        [name]: async (...args: unknown[]) => {
          const at = performance.now()
          if (name === 'getMeta' && !Number.isFinite(firstResumeMs) && at - started >= 5000)
            throw new Error('restart first-payload budget exceeded during ' + String(args[0]))
          try {
            return await Reflect.apply(original, state, args)
          } finally {
            const ms = performance.now() - at
            if (ms > 100)
              awaits.push({ name: name + ':' + String(args[0]).slice(0, 90), ms, at: at - started })
          }
        },
      })
    }
    runtime = open()
    const prepare = runtime.client.prepare.bind(runtime.client)
    runtime.client.prepare = async (...args) => {
      const at = performance.now()
      try {
        return await prepare(...args)
      } finally {
        awaits.push({ name: 'client.prepare', at: at - started, ms: performance.now() - at })
      }
    }
    await expect(runtime.sync()).rejects.toMatchObject({ code: 'offline' })
    console.log('restart await trace', {
      awaits,
      wire,
      maxIdleGap,
      idbRequests: spies.reduce((count, spy) => count + spy.mock.calls.length, 0),
    })
    expect(maxIdleGap).toBeLessThan(1000)
    expect(spies.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBeLessThan(1024)
    for (const sha of present) expect(await runtime.client.hasBlob(sha)).toBe(true)
    console.log('native acknowledged resume', {
      acknowledged,
      resumedHeads,
      firstResumeMs,
      fresh,
      initialFresh,
    })
    expect(acknowledged).toBeGreaterThanOrEqual(32700)
    expect(resumedHeads).toBeLessThanOrEqual(4)
    expect(firstResumeMs).toBeLessThan(5000)
    expect(fresh).toBe(initialFresh)
    console.log('native first-upload 33k', {
      firstPayloadMs,
      hashesAtPayload,
      fresh,
      firstResumeMs,
    })
    expect((await disk.stat(join(root, target))).size).toBe(192 * 1024 * 1024)
  } finally {
    await runtime?.close()
    if (state instanceof IndexedDbStateStore) state.close()
    durable.close()
    spies.forEach((spy) => spy.mockRestore())
    transactions.mockRestore()
    await disk.rm(root, { recursive: true, force: true })
    timers.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(window, key, previous[i]!)
      else Reflect.deleteProperty(window, key)
    })
    vi.unstubAllGlobals()
  }
}, 600000)
