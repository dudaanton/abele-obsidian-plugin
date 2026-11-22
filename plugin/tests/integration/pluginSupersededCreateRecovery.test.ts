import { expect, it } from 'vitest'
import {
  fenceRestoredJournal,
  MemoryStateStore,
  sha256,
  type EngineClient,
  type Journal,
} from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

async function fixture(copy?: string) {
  const app = buildFakeVault([
    { path: 'removed.md', content: 'old sample' },
    ...(copy ? [{ path: copy, content: 'unsent sample' }] : []),
  ])
  const state = new MemoryStateStore()
  await state.setCursor(10)
  await state.put({
    path: 'removed.md',
    wirePath: 'removed.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha: await sha256(new TextEncoder().encode('old sample')),
    size: 10,
    mtime: 1,
  })
  const create = {
    op: 'create' as const,
    path: 'unsent.bin',
    sha: await sha256(new TextEncoder().encode('unsent sample')),
    size: 13,
    mtime: 1,
  }
  const journal: Journal = {
    origin: { cursor: 10, generation: null },
    commitAttempted: false,
    batchId: 'sample-batch',
    idempotencyKey: 'sample-key',
    startedAt: new Date().toISOString(),
    ops: [{ op: 'delete', file_id: 'sample-file', base_version_id: 'base' }, create],
    conflictSources: [
      {
        op: JSON.stringify(create),
        source: {
          path: create.path,
          sha: create.sha,
          size: create.size,
          mtime: 1,
          identity: 'sample-identity',
        },
      },
    ],
  }
  await state.setJournal(journal)
  return { app, state, journal }
}
const client = {
  hasBlob: async () => false,
  versions: async (): Promise<never[]> => [],
} as unknown as EngineClient

it('recovers a deleted unsubmitted create after a restart without replaying the mixed journal', async () => {
  const { app, state } = await fixture()
  const fs = new ObsidianFileSystem(app as never)
  await fenceRestoredJournal(state, 11, fs, undefined, client)
  expect(await state.getJournal()).toBeNull()
  expect(JSON.parse((await state.getMeta('content-reconciliation'))!)).toMatchObject({
    phase: 'requested',
  })
})

it.each(['.hidden/copy.bin', 'ignored/copy.bin', '.abele-sync/private/copy.bin'])(
  'preserves the exact journal and surviving bytes at %s across restarts',
  async (copy) => {
    const { app, state, journal } = await fixture(copy)
    for (let restart = 0; restart < 2; restart++) {
      const fs = new ObsidianFileSystem(app as never, { fileScope: 'synced' })
      await expect(fenceRestoredJournal(state, 11, fs, undefined, client)).rejects.toThrow(
        'unsent bytes'
      )
      expect(await state.getJournal()).toEqual(journal)
      expect(new TextDecoder().decode(await app.vault.adapter.readBinary(copy))).toBe(
        'unsent sample'
      )
    }
  }
)

it('keeps an uncertain submission intact even when its create was deleted locally', async () => {
  const { app, state, journal } = await fixture()
  journal.commitAttempted = true
  await state.setJournal(journal)
  const fs = new ObsidianFileSystem(app as never)
  await expect(fenceRestoredJournal(state, 11, fs, undefined, client)).rejects.toThrow(
    'unsent bytes'
  )
  expect(await state.getJournal()).toEqual(journal)
})

it('finds a hidden copy written during the last server probe and preserves it after restart', async () => {
  const { app, state, journal } = await fixture()
  const racing = {
    ...client,
    hasBlob: async () => {
      await app.vault.adapter.mkdir('.hidden')
      await app.vault.adapter.writeBinary(
        '.hidden/copy.bin',
        new TextEncoder().encode('unsent sample').buffer
      )
      return false
    },
  }
  await expect(
    fenceRestoredJournal(state, 11, new ObsidianFileSystem(app as never), undefined, racing)
  ).rejects.toThrow('unsent bytes')
  expect(await state.getJournal()).toEqual(journal)
  await expect(
    fenceRestoredJournal(state, 11, new ObsidianFileSystem(app as never), undefined, client)
  ).rejects.toThrow('unsent bytes')
  expect(await state.getJournal()).toEqual(journal)
  expect(new TextDecoder().decode(await app.vault.adapter.readBinary('.hidden/copy.bin'))).toBe(
    'unsent sample'
  )
})
