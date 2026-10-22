import { expect, it, vi } from 'vitest'
import { SyncActivityLog, appliedActivity, isSyncTriggerLine } from '@/sync/activityLog'

it.each(['watch', 'fallback', 'events', 'retry', 'reconnect', 'start', 'keep local'])(
  'recognizes the bare %s trigger without hiding outcomes or errors',
  (reason) => {
    expect(isSyncTriggerLine(`sync: ${reason}`)).toBe(true)
    expect(isSyncTriggerLine(`sync: ${reason} failed: offline`)).toBe(false)
    expect(isSyncTriggerLine(`Uploaded Notes/sync: ${reason}.md`)).toBe(false)
  }
)

it('keeps diagnostic failures and useful round results visible', () => {
  for (const line of [
    'sync: done (pushed 2)',
    'sync: held deletes not read: offline',
    'scan: skipped sample.md: invalid path',
  ])
    expect(isSyncTriggerLine(line)).toBe(false)
})

it('does not displace file activity with phases from empty checking rounds', () => {
  const lines: string[] = []
  const log = new SyncActivityLog((line) => lines.push(line))
  for (let i = 0; i < 3; i++) {
    log.update({ stage: 'Checking the vault', completed: 0 })
    log.update({ stage: 'Downloading', completed: 0, total: 0, totalKnown: true, bytes: 0 })
    log.update()
  }
  expect(lines).toEqual([])
})

it('retains interrupted comparison work and only ends at the confirmed scan boundary', () => {
  const lines: string[] = []
  const log = new SyncActivityLog((line) => lines.push(line))
  log.update({ stage: 'Comparing files', completed: 1, total: 120, totalKnown: true })
  log.update({ stage: 'Downloading', completed: 0 })
  log.update({ stage: 'Downloading', completed: 0, total: 0, totalKnown: true })
  log.update()
  log.update({ stage: 'Comparing files', completed: 0, total: 120, totalKnown: true })
  expect(lines.filter((line) => line.startsWith('Downloading'))).toEqual([])
  expect(lines.filter((line) => line.includes('Comparing files: ended'))).toEqual([])
  expect(lines).toContainEqual(expect.stringContaining('stopped at'))
  expect(lines.at(-1)).toContain('1 of 120 files')
  log.finishComparison()
  expect(lines.at(-1)).toBe('Comparing files: ended · Comparing files · 120 of 120 files')
  log.update()
  log.update({ stage: 'Comparing files', completed: 0, total: 120, totalKnown: true })
  expect(lines.at(-1)).toContain('0 of 120 files')
})

it('still reports an indeterminate phase if checking takes thirty seconds', async () => {
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
    log.update({ stage: 'Checking the vault', completed: 0 })
    expect(lines).toEqual([])
    await vi.advanceTimersByTimeAsync(30000)
    expect(lines).toEqual(['Checking the vault: started · Checking the vault'])
    log.update()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    log.update()
    vi.useRealTimers()
  }
})

it('does not announce empty downloads or schedule empty heartbeats after useful work', async () => {
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
    log.update({ stage: 'Uploading', completed: 1, bytes: 20 })
    log.update({ stage: 'Downloading', completed: 0 })
    await vi.advanceTimersByTimeAsync(60000)
    log.update({ stage: 'Downloading', completed: 0, total: 0, totalKnown: true })
    log.update()
    expect(lines.filter((line) => line.startsWith('Downloading'))).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    log.update()
    vi.useRealTimers()
  }
})

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
  expect(lines.at(-1)).toContain('Uploading: stopped at')
  expect(lines.at(-1)).toContain('6 of 100 files')
  const finished = [...lines]
  log.update()
  expect(lines).toEqual(finished)
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
