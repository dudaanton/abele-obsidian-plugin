import { expect, it, vi } from 'vitest'
import { TransferProgress, type TransferSnapshot } from '@/sync/transferProgress'
import { connectionLine } from '@/sync/connectionLine'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { tokenStatus } from '@/sync/tokenStatus'
import { statusText } from '@/sync/status'
import { connectionStatusText } from '@/sync/tokenUi'

it('reports transfer facts through the synchronous status snapshot formatter too', () => {
  expect(
    connectionStatusText(
      { status: 'syncing', paused: false },
      {
        transfer: {
          stage: 'Downloading',
          completed: 20,
          total: 100,
          totalKnown: true,
          bytes: 1024,
          totalBytes: 2048,
        },
      }
    )
  ).toBe('Downloading · 20 of 100 files · 1 of 2 KB')
})

it('uses the short transfer form in the status bar', () => {
  const ui = tokenUiFixture()
  const id = ui.rows.value[0].id
  ui.publish(id, {
    transfer: {
      stage: 'Downloading',
      completed: 3,
      total: 9,
      totalKnown: true,
      bytes: 1024,
      totalBytes: 4096,
    },
  })
  expect(statusText(tokenStatus(ui))).toBe('Downloading · 3 of 9 files')
})

it('names startup, inspection and comparison with readable counts', () => {
  const row = { status: 'syncing' as const, paused: false }
  expect(connectionLine(row, { inspection: { completed: 4000, total: 31000 } })).toBe(
    'Checking the vault · 4 000 of 31 000'
  )
  expect(connectionLine(row, { comparison: { completed: 1, total: 4 } })).toBe(
    'Comparing files · 1 of 4'
  )
  expect(
    connectionLine(row, {
      startup: {
        stage: 'Opening local state',
        completed: 0,
        total: 0,
        startedAt: 0,
        progressAt: 0,
      },
    })
  ).toBe('Opening local state')
})

it('counts pages and deduplicates retried byte ranges', () => {
  let now = 0
  const updates: TransferSnapshot[] = []
  const progress = new TransferProgress(
    (one) => updates.push(one),
    () => now
  )
  progress.begin('Downloading')
  progress.add('a.md', 4)
  progress.bytes('a', 0, 4)
  progress.done('a.md')
  now = 300
  progress.add('b.md', 6)
  progress.inventoryComplete()
  expect(updates.at(-1)).toMatchObject({
    completed: 1,
    total: 2,
    bytes: 4,
    totalBytes: 10,
    totalKnown: true,
  })
  progress.bytes('a', 0, 4)
  progress.bytes('b', 0, 6)
  progress.done('b.md')
  expect(updates.at(-1)).toMatchObject({ completed: 2, bytes: 10 })
  progress.clear()
})

it('counts out-of-order and overlapping acknowledged ranges exactly once', () => {
  let now = 0
  const changed = vi.fn()
  const progress = new TransferProgress(changed, () => now)
  progress.begin('Downloading')
  for (const [offset, length] of [
    [10, 10],
    [0, 10],
    [5, 10],
  ]) {
    now += 250
    progress.bytes('sample', offset, length)
  }
  expect(changed.mock.calls.at(-1)?.[0].bytes).toBe(20)
  progress.clear()
})

it('publishes a trailing current file, throttles chunks and clears its timer', async () => {
  vi.useFakeTimers()
  const changed = vi.fn()
  const progress = new TransferProgress(changed, Date.now, (work, delay) => {
    const timer = window.setTimeout(work, delay)
    return () => window.clearTimeout(timer)
  })
  try {
    progress.begin('Downloading')
    progress.add('sample.bin', 100)
    progress.inventoryComplete()
    progress.current('sample.bin')
    for (let i = 0; i < 10; i++) progress.bytes('sample', i, 1)
    expect(changed).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(250)
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentFile: 'sample.bin', bytes: 10 })
    )
    progress.bytes('sample', 10, 1)
    progress.clear()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    progress.clear()
    vi.useRealTimers()
  }
})

it('omits time left until enough received-byte samples and a known inventory', () => {
  let now = 0
  const changed = vi.fn()
  const progress = new TransferProgress(changed, () => now)
  progress.begin('Downloading')
  progress.add('sample.bin', 100)
  for (let i = 0; i < 3; i++) {
    now += 1000
    progress.bytes('sample', i * 10, 10)
  }
  expect(changed.mock.calls.at(-1)?.[0].secondsLeft).toBeUndefined()
  progress.inventoryComplete()
  expect(changed.mock.calls.at(-1)?.[0].secondsLeft).toBe(7)
  progress.clear()
})

it.each<[TransferSnapshot, string]>([
  [{ stage: 'Downloading', completed: 0 }, 'Downloading'],
  [
    { stage: 'Uploading', completed: 0, total: 1, totalKnown: true, bytes: 0, totalBytes: 0 },
    'Uploading · 0 of 1 file',
  ],
  [
    { stage: 'Downloading', completed: 1, total: 2, totalKnown: false },
    'Downloading · 1 of at least 2 files',
  ],
  [
    { stage: 'Uploading', completed: 1, total: 1, totalKnown: true, bytes: 1024, totalBytes: 1024 },
    'Uploading · 1 of 1 file · 1 of 1 KB',
  ],
  [
    { stage: 'Downloading', completed: 0, total: 0, totalKnown: true, bytes: 0, totalBytes: 0 },
    'Syncing',
  ],
  [
    { stage: 'Downloading', completed: 1, total: 5, totalKnown: true, bytes: 1024 },
    'Downloading · 1 of 5 files · 1 KB transferred',
  ],
])('formats transfer edges honestly', (transfer, expected) => {
  expect(connectionLine({ status: 'syncing', paused: false }, { transfer })).toBe(expected)
})

it('settles an empty server inventory before local comparison and upload', () => {
  const changed = vi.fn()
  const progress = new TransferProgress(changed)
  progress.begin('Downloading')
  progress.inventoryComplete()
  expect(changed).toHaveBeenLastCalledWith()
  progress.begin('Uploading')
  progress.add('sample.md', 7)
  progress.inventoryComplete()
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage: 'Uploading', total: 1, totalBytes: 7 })
  )
  progress.clear()
})

it.each(['Uploading', 'Downloading'])(
  'uses indeterminate wording for an unknown empty %s inventory',
  (stage) => {
    expect(
      connectionLine(
        { status: 'syncing', paused: false },
        { transfer: { stage, completed: 0, total: 0, totalKnown: false, bytes: 0 } }
      )
    ).toBe(stage)
  }
)
