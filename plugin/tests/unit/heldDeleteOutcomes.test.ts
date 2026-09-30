import { describe, expect, it, vi } from 'vitest'
import { EngineRunner } from '@/sync/engineRunner'
import { decidedNotice } from '@/sync/heldDeletes'

function runner() {
  const runner = new EngineRunner({} as never, {} as never)
  const client = {}
  const ops = Array.from({ length: 50 }, (_, n) => ({
    op: 'delete',
    file_id: `f${n}`,
    base_version_id: `v${n}`,
  }))
  const results = Array.from({ length: 50 }, (_, n) => ({
    status: n === 49 ? 'merged' : 'applied',
    file_id: `f${n}`,
    version_id: `next${n}`,
    seq: n + 1,
    path: `Notes/${n}.md`,
    sha: n === 49 ? 'a'.repeat(64) : null,
    size: n === 49 ? 1 : 0,
    mtime: 0,
  }))
  const engine = {
    heldDeletes: vi.fn(async () =>
      Array.from({ length: 50 }, (_, n) => ({ fileId: `f${n}`, path: `Notes/${n}.md` }))
    ),
    decideDeletes: vi.fn(async () => {
      const callback = runner as unknown as {
        recordDeleteResults(vault: unknown, ops: unknown[], results: unknown[]): void
      }
      callback.recordDeleteResults(client, ops, results)
      return { decided: 50, report: {} }
    }),
  }
  const store = {
    byFileId: vi.fn(async (id: string) => (id === 'f49' ? { path: 'Notes/49.md' } : null)),
    getMeta: vi.fn(async () => null),
  }
  Object.assign(runner, { engine, store, vault: client })
  return { runner, engine, store, ids: Array.from({ length: 50 }, (_, n) => `f${n}`) }
}

describe('the outcome of confirmed held deletes', () => {
  it('counts acknowledged deletes, not a sync report that kept one remote edit', async () => {
    const { runner: one, ids } = runner()
    const result = await one.decideDeletes('confirm', ids)
    expect(result).toMatchObject({ decided: 50, completed: 49, applied: false })
    const said = decidedNotice('confirm', result, 'idle')
    expect(said).toContain('49 files were deleted')
    expect(said).not.toContain('50 files were deleted')
    expect(said).not.toContain('will be deleted')
  })

  it('does not treat a forgotten ledger entry as proof of a server delete', async () => {
    const { runner: one, engine, store, ids } = runner()
    store.byFileId.mockResolvedValue(null)
    engine.decideDeletes.mockImplementationOnce(async () => ({ decided: 50, report: {} }))
    expect(await one.decideDeletes('confirm', ids)).toMatchObject({
      decided: 50,
      applied: false,
      completed: 0,
    })
  })

  it('rejects a decision that was never persisted rather than promising a later sync', async () => {
    const { runner: one, engine, ids } = runner()
    engine.decideDeletes.mockRejectedValue(new Error('decision storage unavailable'))
    await expect(one.decideDeletes('confirm', ids)).rejects.toThrow('decision storage unavailable')
  })
})
