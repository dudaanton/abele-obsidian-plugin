import { expect, it, vi } from 'vitest'
import {
  EngineError,
  MemoryStateStore,
  SyncEngine,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { selectiveFrom } from '@/sync/connection'
import { sourcesFromOps } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pushSources.js'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(['.obsidian', '.trash', '.git', '.hidden', '.hidden-file.md'])(
  'reopens an interrupted upload with private sibling %s',
  async (hidden) => {
    const path = 'Shared/K.bin'
    const app = buildFakeVault([
      { path, content: 'sample payload', mtime: 1000 },
      ...(hidden.endsWith('.md')
        ? [{ path: `Shared/${hidden}`, content: 'private' }]
        : [
            { path: `Shared/${hidden}/file.md`, content: 'private' },
            { path: `Shared/Nested/${hidden}/file.md`, content: 'private' },
          ]),
    ])
    const state = new MemoryStateStore()
    await state.setCursor(1)
    await state.setJournal({
      batchId: 'sample-batch',
      idempotencyKey: 'sample-request',
      startedAt: new Date().toISOString(),
      ops: [
        {
          op: 'create',
          path,
          sha: await sha256(new TextEncoder().encode('sample payload')),
          size: 14,
          mtime: 1000,
        },
      ],
    })
    const upload = vi.fn(async () => {
      throw new EngineError('offline', 'sample upload boundary')
    })
    const fs = new LocalFolderPlacement('Shared', 'Shared').fileSystem(
      new ObsidianFileSystem(app as never, { ledger: state, fileScope: 'Shared' })
    )
    const journal = (await state.getJournal())!
    const sources = await sourcesFromOps(fs, state, journal.ops)
    expect(
      await sources.open!(journal.ops[0]!.op === 'create' ? journal.ops[0]!.sha : '')
    ).not.toBeNull()
    const engine = new SyncEngine({
      fs,
      state,
      client: {
        state: async () => ({ head_seq: 1, settings: { max_file_bytes: 1e9, quota_bytes: null } }),
        hasBlob: async () => false,
        putBlobSource: upload,
      } as unknown as EngineClient,
      selective: selectiveFrom(undefined),
    })
    try {
      await expect(engine.sync()).rejects.toThrow('sample upload boundary')
      expect(upload).toHaveBeenCalledOnce()
      expect(await state.getJournal()).not.toBeNull()
    } finally {
      await engine.stop()
    }
  }
)

it('reopens an interrupted upload in a folder connection with nested Unicode siblings', async () => {
  const path = 'Shared/Attachments/Batch 1/Sample.bin'
  const app = buildFakeVault(
    [
      { path, content: 'sample payload', mtime: 1000 },
      ...Array.from({ length: 1000 }, (_, i) => ({
        path: `Shared/Notes/Section ${i % 31}/层 ${i % 7}/Nested ${i % 13}/Sample ${i}.md`,
        content: 'sample',
        mtime: 1000,
      })),
    ],
    { sensitiveNames: true }
  )
  const state = new MemoryStateStore()
  const sha = await sha256(new TextEncoder().encode('sample payload'))
  await state.setCursor(1)
  await state.setJournal({
    batchId: 'sample-batch',
    idempotencyKey: 'sample-request',
    startedAt: new Date().toISOString(),
    ops: [{ op: 'create', path, sha, size: 14, mtime: 1000 }],
  })
  const host = new ObsidianFileSystem(app as never, { ledger: state, fileScope: 'Shared' })
  const upload = vi.fn(async () => {
    throw new EngineError('offline', 'sample upload boundary')
  })
  const client = {
    state: async () => ({ head_seq: 1, settings: { max_file_bytes: 1e9, quota_bytes: null } }),
    hasBlob: async () => false,
    putBlobSource: upload,
  } as unknown as EngineClient
  const engine = new SyncEngine({
    fs: new LocalFolderPlacement('Shared', 'Shared').fileSystem(host),
    state,
    client,
    selective: selectiveFrom(undefined),
  })
  try {
    await expect(engine.sync()).rejects.toThrow('sample upload boundary')
    expect(upload).toHaveBeenCalledOnce()
    expect(await state.getJournal()).not.toBeNull()
  } finally {
    await engine.stop()
  }
})
