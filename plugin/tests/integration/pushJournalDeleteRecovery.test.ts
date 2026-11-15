import { expect, it, vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  push,
  resumeJournal,
  scan,
  sha256,
} from '@abele/sync-sdk/core'
import type { CommitOp, CommitResponse } from '@abele/sync-sdk/protocol'

async function fixture() {
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const bytes = new TextEncoder().encode('original sample')
  await state.put({
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha: await sha256(bytes),
    size: bytes.length,
    mtime: 1,
  })
  await fs.writeAtomic('other.md', new TextEncoder().encode('other content'), 2)
  const commits: Array<{ key: string; ops: CommitOp[] }> = []
  const receipts = new Map<string, CommitResponse>()
  const client = {
    hasBlob: vi.fn(async (): Promise<boolean> => {
      throw new Error('crash during upload')
    }),
    putBlob: vi.fn(async () => {}),
    commitRaw: vi.fn(async (ops: CommitOp[], key: string) => {
      if (receipts.has(key)) return { body: receipts.get(key)!, replayed: true }
      commits.push({ key, ops: structuredClone(ops) })
      const body: CommitResponse = {
        head_seq: commits.length,
        results: ops.map((op, n) => ({
          status: 'applied',
          file_id: 'file_id' in op ? op.file_id : `new-${n}`,
          version_id: `version-${commits.length}-${n}`,
          seq: commits.length,
          path: op.op === 'delete' ? 'sample.md' : op.op === 'create' ? op.path : 'sample.md',
          sha: 'sha' in op ? op.sha : null,
          size: 'size' in op ? op.size : 0,
          mtime: 'mtime' in op ? op.mtime : 0,
        })),
      }
      receipts.set(key, body)
      return { body, replayed: false }
    }),
  }
  const opts = { expected: new ExpectedWrites() }
  const freshPush = async () =>
    push(client as never, fs, state, await scan(fs, state, { excluded: () => false }), opts)
  const resume = () => resumeJournal(client as never, fs, state, opts)
  return { fs, state, bytes, commits, client, freshPush, resume }
}

it.each(['original sample', 'restored different content'])(
  'never publishes an unsent journal deletion after restoring %s while stopped',
  async (content) => {
    const s = await fixture()
    await expect(s.freshPush()).rejects.toThrow('crash during upload')
    expect((await s.state.getJournal())?.ops.some((op) => op.op === 'delete')).toBe(true)
    await s.fs.writeAtomic('sample.md', new TextEncoder().encode(content), 3)
    s.client.hasBlob.mockResolvedValue(true)
    await s.resume()
    await s.freshPush()
    expect(s.commits.flatMap((row) => row.ops).filter((op) => op.op === 'delete')).toEqual([])
    if (content !== 'original sample')
      expect(s.commits.flatMap((row) => row.ops)).toContainEqual(
        expect.objectContaining({
          op: 'modify',
          file_id: 'sample-file',
          sha: await sha256(new TextEncoder().encode(content)),
        })
      )
    expect(await s.state.getJournal()).toBeNull()
  }
)

it('publishes an unsent deletion exactly once when still absent after restart', async () => {
  const s = await fixture()
  await expect(s.freshPush()).rejects.toThrow('crash during upload')
  s.client.hasBlob.mockResolvedValue(true)
  await s.resume()
  await s.resume()
  expect(s.commits.flatMap((row) => row.ops).filter((op) => op.op === 'delete')).toHaveLength(1)
  expect(await s.state.byFileId('sample-file')).toBeNull()
})

it('settles a committed deletion after a crash without publishing it again', async () => {
  const s = await fixture()
  s.client.hasBlob.mockResolvedValue(true)
  const transaction = s.state.transaction.bind(s.state)
  const take = vi.spyOn(s.state, 'transaction')
  const commit = s.client.commitRaw.getMockImplementation()!
  s.client.commitRaw.mockImplementationOnce(async (ops, key) => {
    const result = await commit(ops, key)
    take.mockRejectedValueOnce(new Error('crash after commit'))
    return result
  })
  await expect(s.freshPush()).rejects.toThrow('crash after commit')
  take.mockImplementation(transaction)
  await s.fs.writeAtomic('sample.md', s.bytes, 3)
  const requests = s.client.commitRaw.mock.calls.length
  await s.resume()
  expect(s.client.commitRaw).toHaveBeenCalledTimes(requests)
  expect(s.commits.flatMap((row) => row.ops).filter((op) => op.op === 'delete')).toHaveLength(1)
  expect(await s.state.byFileId('sample-file')).toBeNull()
  expect(await s.fs.stat('sample.md')).not.toBeNull()
  expect(await s.state.getJournal()).toBeNull()
})

it('rechecks absence after uploads on the live publication path', async () => {
  const s = await fixture()
  s.client.hasBlob.mockImplementation(async () => {
    await s.fs.writeAtomic('sample.md', s.bytes, 3)
    return true
  })
  await s.freshPush()
  expect(s.commits.flatMap((row) => row.ops).filter((op) => op.op === 'delete')).toEqual([])
  expect(await s.state.byFileId('sample-file')).not.toBeNull()
})

it('keeps a lost-response deletion uncertain when its local path was restored', async () => {
  const s = await fixture()
  s.client.hasBlob.mockResolvedValue(true)
  const commit = s.client.commitRaw.getMockImplementation()!
  s.client.commitRaw.mockImplementationOnce(async (ops, key) => {
    await commit(ops, key)
    throw new Error('response lost')
  })
  await expect(s.freshPush()).rejects.toThrow('response lost')
  const journal = await s.state.getJournal()
  await s.fs.writeAtomic('sample.md', s.bytes, 3)
  await expect(s.resume()).rejects.toThrow('uncertain deletion requires a commit receipt')
  expect(await s.state.getJournal()).toEqual(journal)
  expect(s.client.commitRaw).toHaveBeenCalledTimes(1)
})

it('replays the exact lost-response request once when its deleted path stays absent', async () => {
  const s = await fixture()
  s.client.hasBlob.mockResolvedValue(true)
  const commit = s.client.commitRaw.getMockImplementation()!
  s.client.commitRaw.mockImplementationOnce(async (ops, key) => {
    await commit(ops, key)
    throw new Error('response lost')
  })
  await expect(s.freshPush()).rejects.toThrow('response lost')
  await s.resume()
  expect(s.client.commitRaw.mock.calls[1]).toEqual(s.client.commitRaw.mock.calls[0])
  expect(s.commits).toHaveLength(1)
  expect(await s.state.byFileId('sample-file')).toBeNull()
  expect(await s.state.metadataKeys('push-publication:')).toEqual([])
})
