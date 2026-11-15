import { expect, it, vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  push,
  resumeJournal,
  scan,
  sha256,
  SyncEngine,
  selectiveDefaults,
  type EngineClient,
} from '@abele/sync-sdk/core'
import type { ChangeItem, CommitOp, CommitResponse } from '@abele/sync-sdk/protocol'

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

it('retires a lost-response deletion into reconciliation when its local path was restored', async () => {
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
  expect((await s.resume())?.reconciliationRequired).toBe(true)
  expect(await s.state.getJournal()).toBeNull()
  expect(
    JSON.parse((await s.state.getMeta(`reconciliation-journal:${journal!.idempotencyKey}`))!)
  ).toEqual(journal)
  expect(JSON.parse((await s.state.getMeta('content-reconciliation'))!).phase).toBe('requested')
  expect(await s.resume()).toBeNull()
  expect(s.client.commitRaw).toHaveBeenCalledTimes(1)
})

it('unblocks ordinary pushes after a request lost before reaching an unchanged server', async () => {
  const s = await fixture()
  s.client.hasBlob.mockResolvedValue(true)
  s.client.commitRaw.mockRejectedValueOnce(new Error('request lost before arrival'))
  await expect(s.freshPush()).rejects.toThrow('request lost before arrival')
  expect(await s.state.getMeta('content-missing')).toBeNull()
  await s.fs.writeAtomic('sample.md', s.bytes, 3)
  const pending = await s.state.getJournal()
  expect((await s.resume())?.reconciliationRequired).toBe(true)
  expect(await s.state.getJournal()).toBeNull()
  // A restart cannot get stuck replaying the retired destructive request.
  expect(await s.resume()).toBeNull()
  await s.freshPush()
  expect(s.commits.flatMap((row) => row.ops).filter((op) => op.op === 'delete')).toEqual([])
  expect(s.commits.flatMap((row) => row.ops)).toContainEqual(
    expect.objectContaining({ op: 'create', path: 'other.md' })
  )
  expect(s.commits.every((row) => row.key !== pending!.idempotencyKey)).toBe(true)
})

it('restarts the full engine and reconciles a restored path after an unsent uncertain request', async () => {
  const s = await fixture()
  await s.state.setCursor(1)
  s.client.hasBlob.mockResolvedValue(true)
  s.client.commitRaw.mockRejectedValueOnce(new Error('request lost before arrival'))
  await expect(s.freshPush()).rejects.toThrow('request lost before arrival')
  await s.fs.writeAtomic('sample.md', s.bytes, 3)
  const logs: string[] = []
  const client = {
    ...s.client,
    state: async () => ({
      head_seq: 1 + s.commits.length,
      settings: {
        conflict: 'merge',
        max_file_bytes: 1000000,
        quota_bytes: null,
        retention: { notes_days: 30, attachments_days: 30, settings_days: 30 },
      },
    }),
    changes: vi.fn(async () => ({
      items: [],
      head_seq: 1 + s.commits.length,
      next_since: 1 + s.commits.length,
    })),
    versions: async () => [],
  } as unknown as EngineClient
  const engine = new SyncEngine({
    fs: s.fs,
    state: s.state,
    client,
    selective: selectiveDefaults(),
    log: (message) => logs.push(message),
  })
  try {
    await engine.sync()
    expect(engine.status.state).toBe('idle')
    expect(await s.state.getJournal()).toBeNull()
    expect(JSON.parse((await s.state.getMeta('content-reconciliation'))!).phase).toBe('complete')
    expect(client.changes).toHaveBeenCalled()
    expect(logs.some((message) => message.includes('uncertain deletion has a restored path'))).toBe(
      true
    )
    expect(s.commits.flatMap((row) => row.ops)).toContainEqual(
      expect.objectContaining({ op: 'create', path: 'other.md' })
    )
    expect(s.commits.flatMap((row) => row.ops).some((op) => op.op === 'delete')).toBe(false)
  } finally {
    await engine.stop()
  }
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

it.each(['recovery', 'restart-after-retirement', 'crash-before-retirement-commit'])(
  'keeps an identical restored file when pulling the committed deletion: %s',
  async (cut) => {
    const s = await fixture()
    await s.fs.remove('other.md')
    await s.state.setCursor(1)
    s.client.hasBlob.mockResolvedValue(true)
    s.client.commitRaw.mockRejectedValueOnce(new Error('committed response lost'))
    await expect(s.freshPush()).rejects.toThrow('committed response lost')
    // The server accepted the request. Restore the exact prior bytes and timestamp.
    await s.fs.writeAtomic('sample.md', s.bytes, 1)
    const deletion: ChangeItem = {
      seq: 2,
      file_id: 'sample-file',
      version_id: 'deleted-version',
      op: 'delete',
      path: 'sample.md',
      prev_path: null,
      sha: null,
      size: null,
      mtime: null,
      kind: 'note',
      actor: { kind: 'device', id: 'sample-peer', name: 'Sample peer' },
      at: '2025-01-01T00:00:00.000Z',
    }
    if (cut === 'crash-before-retirement-commit') {
      const pending = await s.state.getJournal()
      const transaction = s.state.transaction.bind(s.state)
      const commit = vi.spyOn(s.state, 'transaction').mockImplementationOnce((work) =>
        transaction(async (tx) => {
          await work(tx)
          expect(await tx.getJournal()).toBeNull()
          expect(await tx.getMeta('restored-delete-protection:sample-file')).not.toBeNull()
          throw new Error('crash before retirement commit')
        })
      )
      await expect(s.resume()).rejects.toThrow('crash before retirement commit')
      commit.mockRestore()
      expect(await s.state.getJournal()).toEqual(pending)
      expect(await s.state.getMeta('restored-delete-protection:sample-file')).toBeNull()
    } else if (cut === 'restart-after-retirement') {
      expect((await s.resume())?.reconciliationRequired).toBe(true)
      expect(await s.state.getJournal()).toBeNull()
      expect(await s.state.getMeta('restored-delete-protection:sample-file')).not.toBeNull()
      // No in-memory kept set survives this process cut.
    }
    const client = {
      ...s.client,
      state: async () => ({
        head_seq: 2,
        settings: {
          conflict: 'merge',
          max_file_bytes: 1000000,
          quota_bytes: null,
          retention: { notes_days: 30, attachments_days: 30, settings_days: 30 },
        },
      }),
      changes: async (since: number) => ({
        items: since < 2 ? [deletion] : [],
        head_seq: 2,
        next_since: 2,
      }),
      versions: async () => [
        { ...deletion },
        {
          ...deletion,
          op: 'create',
          version_id: 'base',
          sha: await sha256(s.bytes),
          size: s.bytes.length,
          mtime: 1,
        },
      ],
    } as unknown as EngineClient
    const engine = new SyncEngine({
      fs: s.fs,
      state: s.state,
      client,
      selective: selectiveDefaults(),
    })
    try {
      await engine.sync()
      expect(await s.fs.read('sample.md')).toEqual(s.bytes)
      // The incoming deletion is held for review, rather than silently acknowledged.
      expect(await s.state.getMeta('pull-held:sample-file')).not.toBeNull()
      await engine.stop()
      const restarted = new SyncEngine({
        fs: s.fs,
        state: s.state,
        client,
        selective: selectiveDefaults(),
      })
      try {
        await restarted.sync()
        expect(await s.fs.read('sample.md')).toEqual(s.bytes)
      } finally {
        await restarted.stop()
      }
    } finally {
      await engine.stop()
    }
  }
)
