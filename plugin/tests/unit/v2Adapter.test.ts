import { describe, expect, it, vi } from 'vitest'
import { TokenEngineAdapter, eligibleOperations } from '@/sync/v2/adapter'
import type { V2CommitOp, V2CommitResponse } from '@/sync/v2/contract'

const receipt: V2CommitResponse = {
  cursor: 1,
  results: [
    {
      status: 'applied',
      file_id: 'file-a',
      version_id: 'version-a',
      seq: 1,
      path: 'Shared/a.md',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1,
    },
  ],
}
const ops: V2CommitOp[] = [
  { op: 'create', path: 'Shared/a.md', sha: 'a'.repeat(64), size: 1, mtime: 1 },
]
describe('one token engine access boundary', () => {
  it('retains an accepted receipt when its follow-up fetch is forbidden, including after restart', async () => {
    let saved: unknown = null
    const state = {
      read: () => saved,
      write: (value: unknown) => {
        saved = structuredClone(value)
      },
    }
    const commit = vi.fn(async () => receipt)
    const settle = vi.fn(async () => {
      throw new Error('forbidden follow-up content')
    })
    await expect(
      new TokenEngineAdapter({ commit }, state).submit(ops, 'request-a', settle)
    ).rejects.toThrow('forbidden')
    expect(saved).toMatchObject({ requestId: 'request-a', receipt, ops })
    const resumed = new TokenEngineAdapter({ commit }, state)
    await resumed.resume(async (result) => {
      expect(result).toEqual(receipt)
    })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(saved).toBeNull()
  })
  it('replays the exact uncertain request rather than discarding it as a refusal', async () => {
    let saved: unknown = null
    const state = {
      read: () => saved,
      write: (value: unknown) => {
        saved = structuredClone(value)
      },
    }
    const commit = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValue(receipt)
    const adapter = new TokenEngineAdapter({ commit }, state)
    await expect(adapter.submit(ops, 'request-a', async () => {})).rejects.toThrow('lost response')
    await expect(adapter.submit(ops, 'request-b', async () => {})).rejects.toThrow('pending')
    await adapter.resume(async () => {})
    expect(commit.mock.calls).toEqual([
      [ops, 'request-a'],
      [ops, 'request-a'],
    ])
  })
  it('filters holds before the batch budget so a later eligible item progresses', () => {
    const scanned = Array.from(
      { length: 33 },
      (_, n): V2CommitOp => ({ op: 'mkdir', path: 'Shared/' + n })
    )
    for (let cycle = 0; cycle < 3; cycle++)
      expect(eligibleOperations(scanned, (op) => op !== scanned[32], 32)).toEqual([scanned[32]])
  })
  it('dispatches a scope departure separately from deletion and preserves another connection coverage', async () => {
    const events: string[] = []
    const host = {
      content: async () => {},
      departure: async (_id: string, _path: string, retain: boolean) => {
        events.push('departure:' + retain)
      },
      deletion: async () => {
        events.push('delete')
      },
      coveredElsewhere: async () => true,
    }
    const adapter = new TokenEngineAdapter(
      { commit: async () => receipt },
      { read: () => null, write: () => {} }
    )
    await adapter.receive(
      {
        type: 'removal',
        cursor: 1,
        file_id: 'file-a',
        path: 'Shared/a.md',
        at: '2026-01-01T00:00:00Z',
      },
      host
    )
    await adapter.receive(
      {
        type: 'delete',
        cursor: 2,
        file_id: 'file-a',
        path: 'Shared/a.md',
        version_id: 'version-b',
        at: '2026-01-01T00:00:01Z',
      },
      host
    )
    expect(events).toEqual(['departure:true', 'delete'])
  })
})
