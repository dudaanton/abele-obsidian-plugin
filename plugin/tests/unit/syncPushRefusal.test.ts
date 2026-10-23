import { expect, it, vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  push,
  scan,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { AbeleError } from '@abele/sync-sdk/protocol'
import { deferred } from '../helpers/deferred'

it('reports a refused upload while another upload in the same batch remains blocked', async () => {
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const first = new Uint8Array([1]),
    second = new Uint8Array([2])
  await fs.writeAtomic('Notes/first.bin', first, 1000)
  await fs.writeAtomic('Notes/second.bin', second, 1000)
  const firstSha = await sha256(first)
  const resume = deferred<void>(),
    progressed = deferred<void>()
  const rows: unknown[] = []
  Object.assign(state, {
    [Symbol.for('abele.sync.push-refusal-v1')]: (row: unknown) => rows.push(row),
  })
  const commit = vi.fn()
  const client = {
    hasBlob: async () => false,
    putBlob: async (sha: string) => {
      if (sha !== firstSha) await resume.promise
      throw new AbeleError('too_large', 'sample ceiling', { max_bytes: 0 })
    },
    commitRaw: commit,
  } as unknown as EngineClient
  const pending = push(client, fs, state, await scan(fs, state, { excluded: () => false }), {
    expected: new ExpectedWrites(),
    concurrency: 2,
    onProgress: (left) => {
      if (left === 1) progressed.resolve()
    },
  })
  try {
    await progressed.promise
    expect(rows).toEqual([
      expect.objectContaining({ path: 'Notes/first.bin', size: 1, limit: 0, code: 'too_large' }),
    ])
    expect(commit).not.toHaveBeenCalled()
  } finally {
    resume.resolve()
    await pending
  }
})
