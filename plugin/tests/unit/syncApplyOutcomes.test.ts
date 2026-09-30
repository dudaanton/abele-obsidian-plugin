import { describe, expect, it, vi } from 'vitest'
import { EngineRunner } from '@/sync/engineRunner'
import { appliedNotice } from '@/sync/stagedSettings'

describe('reporting settings writes when later bookkeeping fails', () => {
  it('keeps the completed outcome even when reading the remaining queue fails', async () => {
    const runner = new EngineRunner({} as never, {} as never)
    const engine = {
      deferred: vi
        .fn()
        .mockResolvedValueOnce([{ version_id: 'v1', path: '.obsidian/app.json', prev_path: null }])
        .mockRejectedValueOnce(new Error('ledger closed')),
      applyDeferred: vi.fn(async () => ({ applied: ['.obsidian/app.json'], skipped: [] })),
    }
    Object.assign(runner, { engine })
    const result = await runner.applyDeferred(['v1'])
    expect(result).toMatchObject({ applied: ['.obsidian/app.json'], incomplete: 'ledger closed' })
    const notice = appliedNotice({ ...result!, reloaded: false, unshown: [] })
    expect(notice).toContain('Applied 1: .obsidian/app.json')
    expect(notice).toContain('remaining queue could not be read')
    expect(notice).toContain('Reload applied settings')
  })
})
