import { expect, it, vi } from 'vitest'
import { SyncActivityLog, appliedActivity } from '@/sync/activityLog'

it('logs phase boundaries and bounded aggregate updates with real byte counts', () => {
  let now = 0
  const lines: string[] = []
  const log = new SyncActivityLog(
    (line) => lines.push(line),
    () => now
  )
  const snapshot = {
    stage: 'Uploading',
    completed: 0,
    total: 100,
    totalKnown: true,
    bytes: 0,
    totalBytes: 1000,
  }
  log.update(snapshot)
  for (let i = 1; i < 5; i++) log.update({ ...snapshot, completed: i, bytes: i * 10 })
  expect(lines).toHaveLength(1)
  log.update({ ...snapshot, completed: 5, bytes: 50 })
  expect(lines.at(-1)).toContain('5 of 100 files')
  now = 30000
  log.update({ ...snapshot, completed: 6, bytes: 60 })
  expect(lines.at(-1)).toContain('60 of 1000 B')
  log.update({ stage: 'Downloading', completed: 0 })
  expect(lines.at(-2)).toContain('Uploading: ended')
  expect(lines.at(-1)).toBe('Downloading: started · Downloading')
  log.update()
  expect(lines.at(-1)).toContain('Downloading: ended')
})

it('uses confirmed applied changes to distinguish file actions', () => {
  expect(appliedActivity({ kind: 'upsert', origin: 'local', path: 'Notes/sample.md' })).toBe(
    'Uploaded Notes/sample.md'
  )
  expect(appliedActivity({ kind: 'delete', origin: 'local', path: 'Notes/sample.md' })).toBe(
    'Deleted remotely Notes/sample.md'
  )
  expect(appliedActivity({ kind: 'delete', origin: 'remote', path: 'Notes/sample.md' })).toBe(
    'Deleted locally Notes/sample.md'
  )
  expect(
    appliedActivity({ kind: 'move', origin: 'remote', path: 'Notes/new.md', from: 'Notes/old.md' })
  ).toBe('Moved locally Notes/old.md → Notes/new.md')
})

it('keeps a slow transfer visible every thirty seconds and cancels on phase end', async () => {
  vi.useFakeTimers()
  const lines: string[] = []
  const log = new SyncActivityLog(
    (line) => lines.push(line),
    Date.now,
    (work, delay) => {
      const timer = setTimeout(work, delay)
      return () => clearTimeout(timer)
    }
  )
  try {
    log.update({ stage: 'Uploading', completed: 0, bytes: 12 })
    await vi.advanceTimersByTimeAsync(60000)
    expect(lines).toHaveLength(3)
    expect(lines.at(-1)).toContain('12 B transferred')
    log.update()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    log.update()
    vi.useRealTimers()
  }
})
