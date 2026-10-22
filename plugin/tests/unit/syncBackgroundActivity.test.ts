import { expect, it } from 'vitest'
import { Notice, type App } from 'obsidian'
import {
  backgroundActivity,
  observeBackgroundActivity,
  safetyNotice,
} from '@/sync/backgroundActivity'
import { connectionJournalApp } from '@/sync/connectionScope'
import { buildFakeVault } from '../helpers/fakeVault'
import { connectionLine, connectionTone } from '@/sync/connectionLine'

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
