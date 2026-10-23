import { expect, it } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  resumeJournal,
  sha256,
} from '@abele/sync-sdk/core'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'

it('commits a completed bounded push run before a later download fails and resumes only unfinished work', async () => {
  const disk = new MemoryFileSystem(),
    state = new MemoryStateStore()
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
  let calls = 0
  let offline = true
  const client = {
    hasBlob: async () => true,
    getBlob: async () => {
      if (++calls === 2 && offline) throw new Error('sample network cut')
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
  const fs = coordinatedFileSystem(disk, new PathCoordinator())
  const notified: string[] = []
  const opts = {
    expected: new ExpectedWrites(),
    prefetchBytes: 1,
    onApplied: async (change: { path: string }) => {
      notified.push(change.path)
    },
  }
  await expect(resumeJournal(client as never, fs, state, opts)).rejects.toThrow(
    'sample network cut'
  )
  expect((await state.get('one.md'))?.versionId).toBe('received-one')
  expect((await state.get('two.md'))?.versionId).toBe('base')
  expect(await disk.read('one.md')).toEqual(incoming)
  expect(await state.getJournal()).not.toBeNull()
  expect(notified).toEqual(['one.md'])
  offline = false
  await resumeJournal(client as never, fs, state, opts)
  // The completed run now supplies this digest locally; retry needs no download.
  expect(calls).toBe(2)
  expect(notified).toEqual(['one.md', 'two.md'])
  expect(await state.getJournal()).toBeNull()
  for (const name of ['one', 'two']) {
    expect((await state.get(name + '.md'))?.versionId).toBe('received-' + name)
    expect(await disk.read(name + '.md')).toEqual(incoming)
  }
})
