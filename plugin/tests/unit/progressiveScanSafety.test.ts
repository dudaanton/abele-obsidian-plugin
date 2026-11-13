import { afterEach, expect, it, vi } from 'vitest'
import {
  MemoryFileSystem,
  MemoryStateStore,
  SyncEngine,
  scan,
  selectiveDefaults,
  sha256,
  type EngineClient,
  type StateEntry,
} from '@abele/sync-sdk/core'
import type { CommitOp } from '@abele/sync-sdk/protocol'
import { ProgressiveLocalScan, SCAN_HASH_READY } from '@/sync/progressiveLocalScan'

afterEach(() => vi.restoreAllMocks())
const filter = { excluded: () => false }
const bytes = (text: string) => new TextEncoder().encode(text)

it.each(['none', 'confirm', 'restore'] as const)(
  'retains a bulk-deletion hold through a bounded restart after all but one source return (decision=%s)',
  async (decisionKind) => {
    const queued = decisionKind !== 'none'
    const raw = new MemoryFileSystem()
    const state = new MemoryStateStore()
    const list = raw.list.bind(raw)
    vi.spyOn(raw, 'list').mockImplementation(async function* () {
      for await (const info of list()) yield { ...info, ctime: 1000 }
    })
    const stat = raw.stat.bind(raw)
    vi.spyOn(raw, 'stat').mockImplementation(async (path) => {
      const info = await stat(path)
      return info && { ...info, ctime: 1000 }
    })
    const ready = new Set<string>()
    const read = raw.read.bind(raw)
    vi.spyOn(raw, 'read').mockImplementation(async (path) => {
      const data = await read(path)
      ready.add(path)
      return data
    })
    Object.defineProperty(raw, 'trustedIndexIdentities', { value: true })
    Object.defineProperty(raw, SCAN_HASH_READY, {
      value: async (info: { path: string }) => ready.has(info.path),
    })
    const original = bytes('tracked content')
    const originalSha = await sha256(original)
    const remote = new Map<string, StateEntry>()
    const sent: CommitOp[] = []
    let head = 1
    for (let n = 0; n < 60; n++) {
      const path = `tracked-${String(n).padStart(3, '0')}.md`
      const entry = {
        path,
        wirePath: path,
        fileId: `sample-file-${n}`,
        versionId: 'sample-base',
        sha: originalSha,
        size: original.length,
        mtime: 1000,
        ctime: 1000,
      }
      await state.put(entry)
      remote.set(entry.fileId, entry)
      await raw.writeAtomic(path, original, 1000)
    }
    await state.setCursor(head)
    let budget = new ProgressiveLocalScan()
    const client = {
      prepare: async () => budget.begin(),
      state: async () => ({
        head_seq: head,
        settings: {
          conflict: 'merge',
          max_file_bytes: 1000000,
          quota_bytes: null,
          retention: { notes_days: 30, attachments_days: 30, settings_days: 30 },
        },
      }),
      manifest: async () => ({
        head_seq: head,
        next: null,
        items: [...remote.values()].map((row) => ({
          path: row.path,
          file_id: row.fileId,
          version_id: row.versionId,
          kind: 'note',
          sha: row.sha,
          size: row.size,
          mtime: row.mtime,
        })),
      }),
      changes: async () => ({ items: [], head_seq: head, next_since: head }),
      hasBlob: async () => true,
      getBlob: async () => original,
      commitRaw: async (ops: CommitOp[]) => {
        sent.push(...ops)
        const results = ops.map((op) => {
          head++
          if (op.op === 'create') {
            const row = {
              path: op.path,
              wirePath: op.path,
              fileId: `created-${head}`,
              versionId: `version-${head}`,
              sha: op.sha,
              size: op.size,
              mtime: op.mtime,
            }
            remote.set(row.fileId, row)
            return {
              status: 'applied',
              path: row.path,
              file_id: row.fileId,
              version_id: row.versionId,
              seq: head,
              sha: row.sha,
              size: row.size,
              mtime: row.mtime,
            }
          }
          if (op.op === 'modify') {
            const row = {
              ...remote.get(op.file_id)!,
              sha: op.sha,
              size: op.size,
              mtime: op.mtime,
              versionId: `modified-${head}`,
            }
            remote.set(row.fileId, row)
            return {
              status: 'applied',
              path: row.path,
              file_id: row.fileId,
              version_id: row.versionId,
              seq: head,
              sha: row.sha,
              size: row.size,
              mtime: row.mtime,
            }
          }
          if (op.op !== 'delete') throw Error('unexpected operation')
          const row = remote.get(op.file_id)!
          remote.delete(op.file_id)
          return {
            status: 'applied',
            path: row.path,
            file_id: row.fileId,
            version_id: `deleted-${head}`,
            seq: head,
            sha: null,
            size: 0,
            mtime: 1000,
          }
        })
        return { replayed: false, body: { head_seq: head, results } }
      },
    } as unknown as EngineClient
    const make = () =>
      new SyncEngine({
        fs: budget.fileSystem(raw),
        state,
        client,
        selective: selectiveDefaults(),
        deleteGuard: { count: 10, floor: 10, share: 0.25 },
      })
    let engine = make()
    try {
      await engine.sync()
      for (let n = 0; n < 40; n++) await raw.remove(`tracked-${String(n).padStart(3, '0')}.md`)
      const initial = await engine.sync()
      expect(await engine.heldDeletes(), JSON.stringify(initial)).toHaveLength(40)
      await engine.stop()
      for (let n = 1; n < 40; n++)
        await raw.writeAtomic(`tracked-${String(n).padStart(3, '0')}.md`, original, 1000)
      for (let n = 0; n < 40; n++)
        await raw.writeAtomic(`new-${n}.md`, bytes(`new content ${n}`), 2000)
      const heldBefore = await state.getMeta('held-deletes')
      const decision = JSON.stringify({
        kind: decisionKind,
        fileIds: ['sample-file-0'],
        at: new Date().toISOString(),
      })
      if (queued) {
        // A new restore review intentionally archives earlier decisions. This variant
        // files a decision for an existing review, after its restore evidence was seen.
        await state.setMeta(
          'content-reconciliation',
          JSON.stringify({ phase: 'review', reason: 'sample restore review' })
        )
        await state.setMeta('delete-decision', decision)
        await state.setMeta('recent-deletes', '[[1,2]]')
      }
      budget = new ProgressiveLocalScan()
      engine = make()
      await engine.sync()
      expect(budget.pending).toBe(true)
      expect(await state.getMeta('held-deletes')).toBe(heldBefore)
      if (queued) {
        expect(await state.getMeta('delete-decision')).toBe(decision)
        expect(await state.getMeta('recent-deletes')).toBe('[[1,2]]')
      }
      expect(sent.some((op) => op.op === 'delete')).toBe(false)
      const edited = bytes('edited! content')
      if (decisionKind === 'restore') {
        await raw.writeAtomic('tracked-059.md', edited, 1000)
        Reflect.get(engine, 'watch').reported.add('tracked-059.md')
      }
      await engine.sync()
      expect(budget.pending).toBe(false)
      if (queued) {
        expect(await state.getMeta('delete-decision')).toBeNull()
      } else {
        expect(await engine.heldDeletes()).toEqual([
          { fileId: 'sample-file-0', path: 'tracked-000.md' },
        ])
        expect(sent.some((op) => op.op === 'delete')).toBe(false)
        await engine.decideDeletes('confirm', ['sample-file-0'])
      }
      expect(sent.filter((op) => op.op === 'delete')).toHaveLength(
        decisionKind === 'restore' ? 0 : 1
      )
      if (decisionKind === 'restore') expect(await raw.read('tracked-000.md')).toEqual(original)
      if (decisionKind === 'restore')
        expect((await state.get('tracked-059.md'))?.sha).toBe(await sha256(edited))
      expect(await engine.heldDeletes()).toEqual([])
    } finally {
      await engine.stop()
    }
  }
)

it('advances past 32 hint-satisfied candidates while missing sources postpone moves and creates', async () => {
  const raw = new MemoryFileSystem()
  Object.defineProperty(raw, 'trustedIndexIdentities', { value: true })
  Object.defineProperty(raw, SCAN_HASH_READY, { value: async () => false })
  const state = new MemoryStateStore()
  const original = bytes('moved original')
  const sha = await sha256(original)
  await state.put({
    path: 'old.md',
    wirePath: 'old.md',
    fileId: 'sample-moved',
    versionId: 'sample-base',
    sha,
    size: original.length,
    mtime: 1000,
  })
  await state.put({
    path: 'removed.md',
    wirePath: 'removed.md',
    fileId: 'sample-deleted',
    versionId: 'sample-base',
    sha: await sha256(bytes('deleted content')),
    size: 15,
    mtime: 1000,
  })
  for (let n = 0; n < 40; n++) {
    const path = `new-${String(n).padStart(3, '0')}.md`
    const data = n === 39 ? original : bytes(`new content ${n}`)
    await raw.writeAtomic(path, data, 1000)
    if (n < 32)
      await state.setMeta(
        `scan-hint:${encodeURIComponent(path)}`,
        JSON.stringify({
          epoch: JSON.stringify([null, null]),
          size: data.length,
          mtime: 1000,
          sha: await sha256(data),
        })
      )
  }
  const read = vi.spyOn(raw, 'read')
  const budget = new ProgressiveLocalScan()
  const fs = budget.fileSystem(raw)
  const cold = await scan(fs, state, filter, { persistHints: true })
  for (let pass = 0; pass < 3 && budget.pending; pass++) {
    budget.begin()
    const next = await scan(fs, state, filter, { persistHints: true })
    if (!budget.pending) {
      expect(next.ops.filter((op) => op.op === 'move')).toEqual([
        {
          op: 'move',
          file_id: 'sample-moved',
          base_version_id: 'sample-base',
          to_path: 'new-039.md',
        },
      ])
      expect(next.ops.filter((op) => op.op === 'delete')).toHaveLength(1)
      expect(next.ops.filter((op) => op.op === 'create')).toHaveLength(39)
    }
  }
  expect(budget.pending).toBe(false)
  expect(read.mock.calls.every(([path]) => Number(path.slice(4, 7)) >= 32)).toBe(true)
  expect(read).toHaveBeenCalledTimes(8)
  // With these 32 valid hints only the remaining eight files need budget or content I/O.
  expect(cold.hashes.size).toBe(40)
  expect(cold.ops.filter((op) => op.op === 'move')).toHaveLength(1)
  expect(cold.ops.filter((op) => op.op === 'delete')).toHaveLength(1)
  expect(cold.ops.filter((op) => op.op === 'create')).toHaveLength(39)
})

it('does not prefetch cold hints for unchanged tracked files', async () => {
  const fs = new MemoryFileSystem()
  const state = new MemoryStateStore()
  Object.defineProperty(fs, 'trustedIndexIdentities', { value: true })
  for (let i = 0; i < 64; i++) {
    const path = `sample-${i}.md`
    const data = bytes(`content ${i}`)
    await fs.writeAtomic(path, data, 1000)
    await state.put({
      path,
      wirePath: path,
      fileId: `sample-${i}`,
      versionId: 'base',
      size: data.length,
      mtime: 1000,
      sha: await sha256(data),
    })
  }
  const lookups: string[] = []
  Object.assign(state, {
    getMetaMany: async (keys: string[]) => {
      lookups.push(...keys)
      return new Map(
        await Promise.all(keys.map(async (key) => [key, await state.getMeta(key)] as const))
      )
    },
  })
  await scan(fs, state, filter, { persistHints: true })
  expect(lookups.filter((key) => key.startsWith('scan-hint:'))).toEqual([])
})
