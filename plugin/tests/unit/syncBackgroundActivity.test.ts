import { expect, it } from 'vitest'
import { Notice, type App } from 'obsidian'
import {
  backgroundActivity,
  observeBackgroundActivity,
  safetyNotice,
} from '@/sync/backgroundActivity'
import { connectionInspectionApp, connectionJournalApp } from '@/sync/connectionScope'
import { buildFakeVault } from '../helpers/fakeVault'
import { connectionLine, connectionTone } from '@/sync/connectionLine'

it('normalizes proxy registrations and safety notices to the underlying vault', () => {
  const app = buildFakeVault([]) as unknown as App
  const scoped = connectionInspectionApp(app, app.vault.adapter, 'Notes')
  let received = 0
  const stop = observeBackgroundActivity(scoped, () => received++)
  const before = Notice.shown.length
  try {
    backgroundActivity(app, 'Kept a recovery copy')
    expect(received).toBe(1)
    safetyNotice(scoped, 'missing-root', 'Resume required')
    safetyNotice(app, 'missing-root', 'Resume required')
    expect(Notice.shown).toHaveLength(before + 1)
  } finally {
    stop()
  }
  backgroundActivity(scoped, 'After teardown')
  expect(received).toBe(1)
})

it('keeps recovery and safety reasons on the existing status line and badge', () => {
  const row = { status: 'idle' as const, paused: false }
  const activity = { backgroundAttention: 'Kept recoverable copies' }
  expect(connectionTone(row, activity)).toBe('orange')
  expect(connectionLine(row, activity)).toBe(activity.backgroundAttention)
  const stopped = { safetyStop: 'Missing files; Resume required' }
  expect(connectionTone({ ...row, paused: true }, stopped)).toBe('red')
  expect(connectionLine({ ...row, paused: true }, stopped)).toBe(stopped.safetyStop)
})

it('routes repeated background events to their connection without notices', () => {
  const app = buildFakeVault([]) as unknown as App
  const events: unknown[] = []
  const stop = observeBackgroundActivity(app, (owner, text) => events.push([owner, text]))
  const before = Notice.shown.length
  for (let i = 0; i < 50; i++)
    backgroundActivity(connectionJournalApp(app, 'sample'), 'Kept a recovery copy')
  expect(events).toHaveLength(50)
  expect(events[0]).toEqual(['sample', 'Kept a recovery copy'])
  expect(Notice.shown).toHaveLength(before)
  stop()
  backgroundActivity(app, 'Another event')
  expect(events).toHaveLength(50)
})
it('interrupts only once per safety-stop kind across connections in the session', () => {
  const app = buildFakeVault([]) as unknown as App
  const before = Notice.shown.length
  for (let i = 0; i < 50; i++)
    safetyNotice(connectionJournalApp(app, `sample-${i}`), 'missing-root', 'Resume required')
  expect(Notice.shown).toHaveLength(before + 1)
  safetyNotice(app, 'different-stop', 'Review required')
  expect(Notice.shown).toHaveLength(before + 2)
})
