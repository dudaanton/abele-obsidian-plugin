import { describe, expect, it, vi } from 'vitest'
import type { HeldDelete } from '@abele/sync-core'
import { HeldDeletesPrompt } from '@/sync/heldDeletes'
import { DISCONNECTED_STATUS, type SyncStatus } from '@/sync/status'

/**
 * The held-deletes question as the status drives it. A hold is sticky across a restart, and the
 * engine counts it into its status when it starts (task-10 review, #3, fixed in the engine): the
 * first status of a start that carries the count asks, before any sync has run — paused, or
 * offline, a sync may not run for a long time.
 */

const held = (count: number): HeldDelete[] =>
  Array.from({ length: count }, (_, n) => ({ path: `Notes/${n}.md`, fileId: `f${n}` }))

const status = (over: Partial<SyncStatus>): SyncStatus => ({ ...DISCONNECTED_STATUS, ...over })

describe('the held-deletes question at a start', () => {
  it('is asked from the first status that carries a hold, before any sync', async () => {
    const prompt = new HeldDeletesPrompt({
      list: vi.fn(async () => held(12)),
      visible: () => true,
      decide: async () => null,
      note: () => undefined,
    })

    await prompt.noticed(status({ state: 'paused', heldDeletes: 12, lastSyncAt: null }))

    expect(prompt.held.value).toHaveLength(12)
    expect(prompt.asking.value?.held).toHaveLength(12)
  })

  it('shows a decision filed while paused until the files it covers are no longer held', async () => {
    let list = held(3)
    const prompt = new HeldDeletesPrompt({
      list: async () => list,
      visible: () => true,
      decide: async () => null,
      note: () => undefined,
    })
    await prompt.noticed(status({ state: 'paused', heldDeletes: 3 }))

    expect(prompt.filed('confirm', ['f0', 'f1', 'f2'], false)).toBe(false)
    expect(prompt.decided.value).toEqual({ kind: 'confirm', count: 3 })
    expect(prompt.filed('restore', ['f0', 'f1', 'f2'], false)).toBe(true)
    expect(prompt.decided.value).toEqual({ kind: 'restore', count: 3 })

    // Carried out, while more were deleted meanwhile: those are still held, the answer is not.
    list = [{ path: 'Notes/new.md', fileId: 'g0' }]
    await prompt.noticed(status({ state: 'idle', heldDeletes: 1, lastSyncAt: 'x' }))
    expect(prompt.decided.value).toBeNull()
  })
})
