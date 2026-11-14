import { afterEach, expect, it, vi } from 'vitest'
import { COLUMN_FLIGHT_BUFFER, COLUMN_FLIGHT_FLAG, createColumnFlight } from '@/columns/flight'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function fixture(flag: string | null = 'sample-load') {
  const values = new Map<string, string>()
  if (flag !== null) values.set(COLUMN_FLIGHT_FLAG, flag)
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
  let time = 1000
  let tick!: () => void
  const cancel = vi.fn()
  const schedule = vi.fn((callback: () => void) => {
    tick = callback
    return cancel
  })
  const options = { now: () => time, schedule }
  return {
    storage,
    values,
    options,
    schedule,
    cancel,
    advance: (ms: number) => {
      time += ms
    },
    tick: () => tick(),
    read: () => JSON.parse(values.get(COLUMN_FLIGHT_BUFFER) ?? 'null'),
  }
}

it('does no recording work without the flag or for a previous page load', () => {
  for (const flag of [null, 'previous-load']) {
    const f = fixture(flag)
    f.values.set(COLUMN_FLIGHT_BUFFER, 'retained trace')
    expect(createColumnFlight(f.storage, 'sample-load', f.options)).toBeUndefined()
    expect(f.schedule).not.toHaveBeenCalled()
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(f.values.get(COLUMN_FLIGHT_BUFFER)).toBe('retained trace')
    expect(f.storage.getItem).toHaveBeenCalledTimes(1)
  }
})

it('synchronously checkpoints the first entry and each twenty subsequent entries', () => {
  const f = fixture()
  const recorder = createColumnFlight(f.storage, 'sample-load', f.options)!
  try {
    recorder.record('build.in', 120, 10, 90)
    expect(f.read().entries).toEqual([
      { t: 1000, site: 'build.in', docLen: 120, viewportFrom: 10, viewportTo: 90, counter: 1 },
    ])
    for (let i = 0; i < 19; i++) recorder.record('build.frame')
    expect(f.storage.setItem).toHaveBeenCalledTimes(1)
    recorder.record('build.out')
    expect(f.storage.setItem).toHaveBeenCalledTimes(2)
    expect(f.read().entries.at(-1)).toMatchObject({ counter: 21, docLen: 120, viewportFrom: 10 })
  } finally {
    recorder.destroy()
  }
})

it('flushes elapsed wall time inside a synchronous loop and pending entries on the timer', () => {
  const f = fixture()
  const recorder = createColumnFlight(f.storage, 'sample-load', f.options)!
  try {
    recorder.record('measure.in')
    recorder.record('measure.read')
    f.advance(100)
    recorder.record('measure.write')
    expect(f.read().entries.at(-1).site).toBe('measure.write')
    recorder.record('measure.out')
    f.advance(100)
    f.tick()
    expect(f.read().entries.at(-1).site).toBe('measure.out')
    const writes = f.storage.setItem.mock.calls.length
    f.tick()
    expect(f.storage.setItem).toHaveBeenCalledTimes(writes)
  } finally {
    recorder.destroy()
  }
})

it('retains the last five hundred records in chronological order across persistence', () => {
  const f = fixture()
  const recorder = createColumnFlight(f.storage, 'sample-load', f.options)!
  for (let i = 0; i < 1250; i++) recorder.record('resize.callback', i, i, i + 1)
  recorder.destroy()
  expect(f.cancel).toHaveBeenCalledOnce()
  const saved = f.read()
  expect(saved.epoch).toBe('sample-load')
  expect(saved.entries).toHaveLength(500)
  expect(saved.entries[0].counter).toBe(751)
  expect(saved.entries.at(-1).counter).toBe(1250)
  expect(saved.entries.map((entry: { counter: number }) => entry.counter)).toEqual(
    Array.from({ length: 500 }, (_, i) => i + 751)
  )
  const writes = f.storage.setItem.mock.calls.length
  recorder.record('after.destroy')
  f.tick()
  expect(f.storage.setItem).toHaveBeenCalledTimes(writes)
  // A relaunched page cannot replace the saved tail, even if the old flag remains.
  expect(createColumnFlight(f.storage, 'next-load', f.options)).toBeUndefined()
  expect(f.read()).toEqual(saved)
})

it('continues a same-page trace after plugin reload and safely replaces malformed data', () => {
  const f = fixture()
  const first = createColumnFlight(f.storage, 'sample-load', f.options)!
  first.record('before.reload', 42, 0, 42)
  first.destroy()
  const second = createColumnFlight(f.storage, 'sample-load', f.options)!
  second.record('after.reload')
  second.destroy()
  expect(f.read().entries.map((entry: { counter: number }) => entry.counter)).toEqual([1, 2])
  expect(f.read().entries.at(-1).docLen).toBe(42)
  f.values.set(COLUMN_FLIGHT_BUFFER, '{invalid')
  const third = createColumnFlight(f.storage, 'sample-load', f.options)!
  third.record('fresh')
  third.destroy()
  expect(f.read().entries).toHaveLength(1)
})

it('never lets unavailable storage interrupt editor work', () => {
  const f = fixture()
  f.storage.getItem.mockImplementation(() => {
    throw new Error('unavailable')
  })
  expect(() => createColumnFlight(f.storage, 'sample-load', f.options)).not.toThrow()
  expect(f.schedule).not.toHaveBeenCalled()
  f.storage.getItem.mockImplementation((key) => f.values.get(key) ?? null)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const recorder = createColumnFlight(f.storage, 'sample-load', f.options)!
  f.storage.setItem.mockImplementation(() => {
    throw new Error('quota')
  })
  expect(() => {
    for (let i = 0; i < 100; i++) recorder.record('build.in')
    f.tick()
    recorder.destroy()
  }).not.toThrow()
  expect(warning).toHaveBeenCalledOnce()
})

it('uses the default 100 ms heartbeat and cancels it on destruction', () => {
  vi.useFakeTimers()
  const f = fixture()
  const recorder = createColumnFlight(f.storage, 'sample-load')!
  try {
    recorder.record('first')
    recorder.record('pending')
    vi.advanceTimersByTime(99)
    expect(f.read().entries.at(-1).site).toBe('first')
    vi.advanceTimersByTime(1)
    expect(f.read().entries.at(-1).site).toBe('pending')
  } finally {
    recorder.destroy()
  }
  expect(vi.getTimerCount()).toBe(0)
})
