import { describe, expect, it } from 'vitest'
import {
  connectionBusy,
  connectionLine,
  connectionProgress,
  connectionTone,
} from '@/sync/connectionLine'
import { DISCONNECTED_STATUS, statusText, statusTooltip, statusWarns } from '@/sync/status'
import { phoneSyncIcon } from '@/sync/phoneSyncAction'
import { tokenStatus } from '@/sync/tokenStatus'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { connectionStatusText, SCOPE_DELETED } from '@/sync/tokenUi'

const idle = { status: 'idle' as const, paused: false }

describe('a connection row', () => {
  it.each(['own', 'shared'] as const)(
    'shows a %s safety stop above ordinary pause and stale progress',
    (source) => {
      const row = { status: 'paused' as const, paused: true }
      const reason = 'Folder unavailable; choose Resume'
      const activity = {
        ...(source === 'own' ? { safetyStop: reason } : { sharedSafetyStop: reason }),
        comparison: { completed: 1, total: 100 },
      }
      expect(connectionLine(row, activity)).toBe(reason)
      expect(connectionStatusText(row, activity)).toBe(reason)
      expect(connectionTone(row, activity)).toBe('red')
      expect(connectionBusy(row, activity)).toBe(false)
      const ui = tokenUiFixture()
      ui.rows.value = [{ ...ui.rows.value[0], ...row }]
      ui.activity.value = { [ui.rows.value[0].id]: activity }
      const status = tokenStatus(ui)
      expect(status.state).toBe('error')
      expect(status.lastError).toBe(reason)
      expect(statusTooltip(status)).toContain(reason)
    }
  )
  it('keeps a missing root decision visible over stale startup activity', () => {
    const row = { ...idle, rootIssue: { kind: 'deleted' as const } }
    expect(connectionBusy(row, { comparison: { completed: 1, total: 1000 } })).toBe(false)
    expect(connectionTone(row)).toBe('red')
    expect(connectionLine(row, { comparison: { completed: 1, total: 1000 } })).toBe(
      'Folder is gone; sync stopped'
    )
  })
  it('shows permanent server deletion above a stale startup or pause', () => {
    const row = { status: 'error' as const, paused: true }
    const activity = {
      error: SCOPE_DELETED,
      startup: { stage: 'Checking', completed: 0, total: 1, startedAt: 1, progressAt: 1 },
    }
    expect(connectionLine(row, activity)).toBe('Deleted on the server')
    expect(connectionBusy(row, activity)).toBe(false)
    expect(connectionTone(row, activity)).toBe('red')
  })
  it('says when it last synced and is green when everything is through', () => {
    expect(connectionLine(idle, { lastSync: Date.now() - 120_000 })).toBe('Synced 2 minutes ago')
    expect(connectionTone(idle, { lastSync: Date.now() })).toBe('green')
    expect(connectionLine(idle)).toBe('Not synced yet')
  })
  it('counts a running exchange, glows the accent and offers a bar', () => {
    const activity = { completed: 12, total: 40 }
    expect(connectionLine(idle, activity)).toBe('12 of 40 files')
    expect(connectionTone(idle, activity)).toBe('accent')
    expect(connectionBusy(idle, activity)).toBe(true)
    expect(connectionProgress(activity)).toEqual({ completed: 12, total: 40 })
    expect(connectionProgress({ completed: 40, total: 40 })).toBeNull()
  })
  it('is orange for a pause, a missing server and a conflict copy, red when the person must act', () => {
    expect(connectionLine({ status: 'paused', paused: true })).toBe('Paused')
    expect(connectionTone({ status: 'paused', paused: true })).toBe('orange')
    expect(connectionLine({ status: 'offline', paused: false })).toBe(
      'Server unavailable, retrying'
    )
    expect(connectionLine(idle, { conflicts: ['a.md', 'b.md'] })).toBe('2 conflict copies')
    expect(connectionTone(idle, { conflicts: ['a.md'] })).toBe('orange')
    expect(connectionLine(idle, { refused: [{ path: 'a.mov', reason: 'big' }] })).toBe(
      '1 file not sent'
    )
    expect(connectionTone({ status: 'error', paused: false })).toBe('red')
    expect(connectionLine({ status: 'error', paused: false })).toBe('Needs attention')
  })
})

describe('the status bar across connections', () => {
  it('counts held deletes and deferred changes only for attached connections', () => {
    const ui = tokenUiFixture()
    const [first, second] = ui.rows.value
    ui.rows.value = [first, second].map((row) => ({ ...row, status: 'idle' }))
    ui.candidates.value = []
    ui.questions.value = []
    ui.activity.value = {
      [first.id]: { heldDeletes: 3, deferred: 2 },
      [second.id]: { heldDeletes: 4, deferred: 1 },
      detached: { heldDeletes: 100, deferred: 100 },
    }
    const status = tokenStatus(ui)
    expect(status.heldDeletes).toBe(7)
    expect(status.deferred).toBe(3)
    expect(statusText(status)).toBe('Deletions held (7)')
    expect(statusWarns(status)).toBe(true)
    expect(statusTooltip(status)).toContain('Settings waiting (3)')
    ui.publish(first.id, { heldDeletes: 0, deferred: 0 })
    expect(tokenStatus(ui)).toMatchObject({ heldDeletes: 4, deferred: 1 })
    ui.publish(second.id, { heldDeletes: 0, deferred: 0 })
    expect(statusWarns(tokenStatus(ui))).toBe(false)
  })
  it('leads with conflict copies in the warning colour, then with what waits for a decision', () => {
    const ui = tokenUiFixture()
    const status = tokenStatus(ui)
    expect(status.state).toBe('offline')
    expect(status.conflicts).toBe(1)
    expect(status.review).toBe(2)
    const settled = { ...status, state: 'idle' as const }
    expect(statusText(settled)).toBe('1 conflict')
    expect(statusWarns(settled)).toBe(true)
    expect(statusTooltip(settled)).toContain('1 conflict copy was saved')
    expect(statusText({ ...settled, conflicts: 0 })).toBe('To review (2)')
    expect(statusWarns({ ...settled, conflicts: 0 })).toBe(false)
  })
  it('is hidden with no connections', () => {
    expect(tokenStatus(tokenUiFixture(true)).state).toBe('disconnected')
  })
})

describe('the cloud in a phone note header', () => {
  it('shows only when something is wrong', () => {
    expect(phoneSyncIcon({ ...DISCONNECTED_STATUS, state: 'idle' })).toBeNull()
    expect(phoneSyncIcon({ ...DISCONNECTED_STATUS, state: 'syncing' })).toBeNull()
    expect(phoneSyncIcon({ ...DISCONNECTED_STATUS, state: 'offline' })?.icon).toBe('cloud-off')
    expect(phoneSyncIcon({ ...DISCONNECTED_STATUS, state: 'error' })).toMatchObject({
      icon: 'cloud-alert',
      warning: true,
    })
    expect(phoneSyncIcon({ ...DISCONNECTED_STATUS, state: 'idle', conflicts: 1 })?.tooltip).toBe(
      'Sync: 1 conflict copy'
    )
  })
})
