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

it('starts comparison again when the interrupted inventory shrinks', () => {
  const lines: string[] = []
  const log = new SyncActivityLog((line) => lines.push(line))
  log.update({ stage: 'Comparing files', completed: 80, total: 100, totalKnown: true })
  log.update()
  log.update({ stage: 'Comparing files', completed: 0, total: 50, totalKnown: true })
  expect(lines.at(-1)).toBe(
    'Comparing files: started again (inventory changed) · Comparing files · 0 of 50 files'
  )
  log.finishComparison()
  expect(lines.at(-1)).toContain('50 of 50 files')
})

it.each(Array.from({ length: 20 }, (_, i) => i + 1))(
  'keeps comparison counters bounded and monotonic through random lifecycle sequences (seed %s)',
  (seed) => {
    let random = seed,
      now = 0,
      floor = 0,
      observed = 0
    const next = (bound: number) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      return Math.floor((random / 0x100000000) * bound)
    }
    const log = new SyncActivityLog(
      (line) => {
        if (line.includes('started again (inventory changed)')) floor = 0
        const counts = line.match(/(\d+) of (\d+) files?/)
        if (!counts) return
        const done = Number(counts[1]),
          total = Number(counts[2])
        expect(done, line).toBeGreaterThanOrEqual(0)
        expect(done, line).toBeLessThanOrEqual(total)
        expect(done, line).toBeGreaterThanOrEqual(floor)
        floor = done
        observed++
      },
      () => now
    )
    let total = 100
    const actions = new Set<number>()
    for (let step = 0; step < 400; step++) {
      now += 31000
      const action = next(4)
      actions.add(action)
      switch (action) {
        case 0:
          log.update()
          break
        case 1:
          total = next(101)
          log.update({ stage: 'Checking the vault', completed: 0 })
          break
        case 2:
          log.finishComparison(total)
          floor = 0
          break
        default:
          log.update({
            stage: 'Comparing files',
            completed: next(total + 1),
            total,
            totalKnown: true,
          })
      }
    }
    log.finishComparison(total)
    expect(actions.size).toBe(4)
    expect(observed).toBeGreaterThan(20)
  }
)

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
