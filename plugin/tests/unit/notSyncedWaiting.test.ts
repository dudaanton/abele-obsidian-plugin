import { describe, expect, it } from 'vitest'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { connectionLine, connectionTone } from '@/sync/connectionLine'
import { groupNotSynced, splitNotSynced, type NotSyncedItem } from '@/sync/notSynced'
import { NotSyncedState } from '@/sync/notSyncedState'
import { statusText, statusWarns } from '@/sync/status'
import { tokenStatus } from '@/sync/tokenStatus'
import { tokenUiFixture } from '@/testing/tokenUiFixture'

// A file that only waits (a full server, a rate limit) keeps the waiting word and its own count;
// "not synced" is for refusals the person has to deal with.
const item = (path: string, kind: NotSyncedItem['kind']): NotSyncedItem => ({
  path,
  kind,
  direction: 'out',
  since: '2026-01-01T00:00:00Z',
})
const waiting = { path: 'Media/sample-wait.bin', reason: 'The server is full.', waiting: true }
const large = { path: 'Media/sample-large.mov', reason: 'too large' }

function settled(activity: Record<string, unknown>) {
  const ui = tokenUiFixture()
  const [first, second] = ui.rows.value
  ui.rows.value = [first, second].map((row) => ({ ...row, status: 'idle' }))
  ui.candidates.value = []
  ui.questions.value = []
  ui.activity.value = { [first.id]: activity, [second.id]: { lastSync: Date.now() } }
  return tokenStatus(ui)
}

describe('the status bar', () => {
  it('says waiting, not "not synced", for a file that only waits', () => {
    const status = settled({ refused: [waiting], pending: 1 })
    expect(status.notSynced).toBe(0)
    expect(statusText(status)).toBe('1 file waiting')
    expect(statusWarns(status)).toBe(false)
  })
  it('counts a waiting row from the read list as waiting', () => {
    const status = settled({ notSynced: [item('Media/sample-wait.bin', 'waiting')] })
    expect(status.notSynced).toBe(0)
    expect(statusText(status)).toBe('1 file waiting')
  })
  it('shows both when a refusal and a wait stand together', () => {
    const live = settled({ refused: [large, waiting], pending: 2 })
    expect(statusText(live)).toBe('1 file not synced · 1 waiting')
    expect(statusWarns(live)).toBe(true)
    const listed = settled({
      notSynced: [
        item('Media/sample-large.mov', 'too-large'),
        item('Media/sample-wait.bin', 'waiting'),
      ],
      pending: 2,
    })
    expect(statusText(listed)).toBe('1 file not synced · 1 waiting')
  })
})

describe('the connection line', () => {
  const row = { status: 'idle' as const, paused: false }
  it.each([1, 4, 1243])(
    'formats %s waiting files consistently, alone and with refusals',
    (count) => {
      const rows = Array.from({ length: count }, (_, i) => item(`sample-${i}.bin`, 'waiting'))
      const full = `${count.toLocaleString()} ${count === 1 ? 'file' : 'files'} waiting`
      expect(connectionLine(row, { notSynced: rows })).toBe(full)
      expect(statusText(settled({ notSynced: rows }))).toBe(full)
      const mixed = [item('refused.mov', 'too-large'), ...rows]
      const short = `1 file not synced · ${count.toLocaleString()} waiting`
      expect(connectionLine(row, { notSynced: mixed })).toBe(short)
      expect(statusText(settled({ notSynced: mixed }))).toBe(short)
    }
  )
  it('says waiting for a file that only waits, live or listed', () => {
    expect(connectionLine(row, { refused: [waiting] })).toBe('1 file waiting')
    expect(connectionLine(row, { notSynced: [item('a.bin', 'waiting')] })).toBe('1 file waiting')
    expect(connectionTone(row, { refused: [waiting] })).toBe('orange')
  })
  it('says not synced for a refusal, and both when both stand', () => {
    expect(connectionLine(row, { refused: [large] })).toBe('1 file not synced')
    expect(connectionLine(row, { refused: [large, waiting] })).toBe('1 file not synced · 1 waiting')
    expect(
      connectionLine(row, {
        notSynced: [item('a.mov', 'too-large'), item('b.bin', 'waiting'), item('c.bin', 'waiting')],
      })
    ).toBe('1 file not synced · 2 waiting')
  })
})

describe('the list', () => {
  it('keeps waiting files apart from the files that are not synced', () => {
    const rows = [item('a.mov', 'too-large'), item('b.bin', 'waiting'), item('c.bin', 'server')]
    const parts = splitNotSynced(rows)
    expect(parts.refused.map((one) => one.path)).toEqual(['a.mov', 'c.bin'])
    expect(parts.waiting.map((one) => one.path)).toEqual(['b.bin'])
    expect(groupNotSynced(parts.waiting).map((group) => [group.kind, group.retry])).toEqual([
      ['waiting', true],
    ])
  })
  it('reads a full server and a rate limit as waiting, and a policy refusal as refused', async () => {
    const state = new MemoryStateStore()
    const retry = (path: string, reason: string) =>
      state.setMeta(
        'file-retry:' + path,
        JSON.stringify({ path, phase: 'push', reason, attempts: 1, nextAt: 0, quarantined: false })
      )
    await retry('full.bin', 'quota_exceeded: quota')
    await retry('busy.bin', 'quota_waiting: outstanding uploads')
    await retry('slow.bin', 'rate_limited: later')
    await retry('policy.bin', 'forbidden: not allowed')
    const rows = await new NotSyncedState(state).snapshot()
    expect(rows.map((row) => [row.path, row.kind])).toEqual([
      ['busy.bin', 'waiting'],
      ['full.bin', 'waiting'],
      ['policy.bin', 'server'],
      ['slow.bin', 'waiting'],
    ])
  })
})
