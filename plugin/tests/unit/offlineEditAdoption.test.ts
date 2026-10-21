import { expect, it, vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  pull,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'

it.each(
  [false, true].flatMap((bounded) =>
    [false, true].flatMap((preserveStamp) =>
      [false, true].flatMap((knownCopy) =>
        ['sample.md', 'renamed.md', 'Moved/sample.md'].flatMap((localPath) =>
          [false, true].map((deferred) => ({
            bounded,
            preserveStamp,
            knownCopy,
            localPath,
            deferred,
          }))
        )
      )
    )
  )
)(
  'holds offline edits across equal and later remote pages ($localPath, $bounded, $preserveStamp, $knownCopy, $deferred)',
  async ({ bounded, preserveStamp, knownCopy, localPath, deferred }) => {
    const fs = new MemoryFileSystem(),
      state = new MemoryStateStore()
    const a = new TextEncoder().encode('sample A')
    const b = new TextEncoder().encode('sample B')
    const c = new TextEncoder().encode('sample C')
    const shaA = await sha256(a),
      shaB = await sha256(b),
      shaC = await sha256(c)
    await fs.writeAtomic('sample.md', a, 1000)
    const base = {
      path: 'sample.md',
      wirePath: 'sample.md',
      fileId: 'sample-file',
      versionId: 'version-a',
      sha: shaA,
      size: a.length,
      mtime: 1000,
    }
    await state.put(base)
    if (knownCopy) {
      await fs.writeAtomic('known.md', b, 1000)
      await state.put({
        ...base,
        path: 'known.md',
        wirePath: 'known.md',
        fileId: 'known-file',
        versionId: 'known-b',
        sha: shaB,
      })
    }
    await state.setCursor(1)
    if (localPath !== base.path) await fs.move(base.path, localPath)
    await fs.writeAtomic(localPath, b, preserveStamp ? 1000 : 2000)
    const before = await fs.stat(localPath)
    const write = vi.spyOn(fs, 'writeAtomic'),
      move = vi.spyOn(fs, 'move'),
      remove = vi.spyOn(fs, 'remove')
    const stage = vi.fn(async () => {
      throw new Error('Offline edit must not be staged for replacement')
    })
    if (bounded)
      Object.assign(fs, {
        openRead: async (path: string) => ({
          size: b.length,
          read: async (offset: number, length: number) =>
            (await fs.read(path)).slice(offset, offset + length),
          assertUnchanged: async () => {},
          close: async () => {},
        }),
        beginAtomicWrite: stage,
        reopenStage: stage,
      })
    const change = (seq: number, sha: string, version: string) => ({
      seq,
      file_id: base.fileId,
      version_id: version,
      path: localPath,
      prev_path: null,
      op: 'modify',
      kind: 'note',
      sha,
      size: b.length,
      mtime: 3000 + seq,
      at: '',
      actor: { kind: 'system', id: 'sample', name: 'Sample' },
    })
    let afterEqual: Awaited<ReturnType<typeof state.byFileId>> = null
    const changes = vi.fn(async (since: number) => {
      if (since === 1) return { items: [change(2, shaB, 'version-b')], head_seq: 3, next_since: 2 }
      expect(since).toBe(2)
      afterEqual = await state.byFileId(base.fileId)
      return { items: [change(3, shaC, 'version-c')], head_seq: 3, next_since: 3 }
    })
    const client = {
      changes,
      getBlob: async (sha: string) => (sha === shaB ? b : c).slice(),
      openVersion: async (_id: string, version: string) => {
        const bytes = version === 'version-b' ? b : c
        return {
          size: bytes.length,
          read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
          assertUnchanged: async () => {},
          close: async () => {},
        }
      },
    } as unknown as EngineClient
    const result = await pull(client, fs, state, {
      defer: deferred ? () => true : undefined,
      filter: { excluded: () => false },
      dirty: new Set(),
      expected: new ExpectedWrites(),
    })
    expect(changes.mock.calls.map(([since]) => since)).toEqual([1, 2])
    expect(await fs.read(localPath)).toEqual(b)
    // Equal bytes on page one must not acknowledge an unpushed edit as a clean base.
    expect(afterEqual).toEqual(base)
    if (!deferred)
      expect(result.held).toEqual(
        expect.arrayContaining([expect.objectContaining({ seq: 3, version_id: 'version-c' })])
      )
    expect(await state.byFileId(base.fileId)).toEqual(base)
    expect(await fs.stat(localPath)).toEqual(before)
    expect(write).not.toHaveBeenCalled()
    expect(move).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(stage).not.toHaveBeenCalled()
  }
)
