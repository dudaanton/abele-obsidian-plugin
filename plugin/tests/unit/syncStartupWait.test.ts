import { expect, it } from 'vitest'
import {
  waitForStartup,
  STARTUP_WAIT,
  startupWaitFailure,
  startupScanProgress,
  startupExchangeProgress,
} from '../e2e/helpers/startupWait'
import { ExchangeTrace } from '@/sync/exchangeTrace'
import { firstFolderBudget, FIRST_FOLDER_STALL_MS } from '../helpers/smallPullBounds'

it.each([false, true])(
  'accepts completing commits, uploads and changes with fixed UI progress (browser=%s)',
  async (browser) => {
    const progress = browser
      ? (new Function(
          STARTUP_WAIT + ';return startupExchangeProgress'
        )() as typeof startupExchangeProgress)
      : startupExchangeProgress
    const trace = new ExchangeTrace()
    const operations = ['POST /v2/commit', 'PUT /v2/uploads/sample/part/0', 'GET /v2/changes']
    let finish = trace.begin(operations[0])
    // Use the same diagnostic counters the real trace exposes; duration and active
    // request timestamps are deliberately absent from the progress signature.
    let now = 0
    await waitForStartup(
      () => ({ ready: now >= 45000, progress: JSON.stringify(progress(trace.snapshot())) }),
      30000,
      async () => {
        finish()
        now += 1000
        finish = trace.begin(operations[(now / 1000) % operations.length])
      },
      () => now,
      90000
    )
    finish()
    expect(now).toBe(45000)
  }
)

it.each([false, true])(
  'stalls a never-completing request despite changing durations and raw ring positions (browser=%s)',
  async (browser) => {
    const progress = browser
      ? (new Function(
          STARTUP_WAIT + ';return startupExchangeProgress'
        )() as typeof startupExchangeProgress)
      : startupExchangeProgress
    let now = 0
    await expect(
      waitForStartup(
        () => {
          const exchange = {
            firstSync: { stages: [{ stage: 'transfer', completed: 0, durationMs: now }] },
            active: [{ operation: 'POST /v2/commit', elapsedMs: now }],
            requestNext: now % 64,
          }
          return { ready: false, progress: JSON.stringify(progress(exchange)) }
        },
        30000,
        async () => {
          now += 1000
        },
        () => now,
        90000
      )
    ).rejects.toThrow('progress stalled')
    expect(now).toBe(30000)
  }
)

it.each([false, true])(
  'accepts advancing scan paths while transfer and startup counters stay fixed (browser=%s)',
  async (browser) => {
    const progress = browser
      ? (new Function(STARTUP_WAIT + ';return startupScanProgress')() as typeof startupScanProgress)
      : startupScanProgress
    let now = 0
    await waitForStartup(
      () => ({
        ready: now >= 45000,
        progress: JSON.stringify(
          progress({
            phase: 'yielding files',
            samples: [
              { operation: 'adapter stat', paths: ['sample-' + Math.floor(now / 1000) + '.md'] },
            ],
          })
        ),
      }),
      30000,
      async () => {
        now += 1000
      },
      () => now,
      90000
    )
    expect(now).toBe(45000)
  }
)

it('still detects repeated I/O on one path even while timestamps and operation names change', async () => {
  let now = 0
  await expect(
    waitForStartup(
      () => ({
        ready: false,
        progress: JSON.stringify(
          startupScanProgress({
            phase: 'yielding files',
            samples: [
              {
                operation: now % 2000 ? 'adapter stat' : 'adapter readBinary',
                paths: ['sample.md'],
                at: now,
              },
            ],
          })
        ),
      }),
      30000,
      async () => {
        now += 1000
      },
      () => now,
      90000
    )
  ).rejects.toThrow('progress stalled')
  expect(now).toBe(30000)
})

it.each([false, true])(
  'fails unchanged known 0/0 transfer progress (browser=%s)',
  async (browser) => {
    const wait = browser
      ? (new Function(STARTUP_WAIT + ';return waitForStartup')() as typeof waitForStartup)
      : waitForStartup
    let now = 0
    const transfer = { stage: 'Downloading', completed: 0, total: 0, totalKnown: true, bytes: 0 }
    await expect(
      wait(
        () => ({ ready: false, progress: JSON.stringify(transfer) }),
        FIRST_FOLDER_STALL_MS,
        async () => {
          now += 1000
        },
        () => now,
        firstFolderBudget(1024)
      )
    ).rejects.toThrow('Sync startup progress stalled:')
    expect(now).toBe(FIRST_FOLDER_STALL_MS)
  }
)

it('keeps a safe stall reason when the connect action is confidential', () => {
  expect(
    startupWaitFailure(new Error('Sync startup progress stalled: private sample detail'))
  ).toBe('Sync startup progress stalled')
  expect(startupWaitFailure('Sync startup deadline exceeded: private sample detail')).toBe(
    'Sync startup deadline exceeded'
  )
  expect(startupWaitFailure(new Error('Unexpected private sample detail'))).toBeUndefined()
})

it('allows a slow first-folder pull beyond the old limit while files keep advancing', async () => {
  let now = 0
  await waitForStartup(
    () => ({ ready: now >= 240000, progress: 'Downloading:' + Math.floor(now / 10000) + '/1024' }),
    FIRST_FOLDER_STALL_MS,
    async () => {
      now += 1000
    },
    () => now,
    firstFolderBudget(1024)
  )
  expect(now).toBe(240000)
})

it('fails a stalled first-folder pull despite its file-scaled total guard', async () => {
  const browserWait = new Function(
    STARTUP_WAIT + ';return waitForStartup'
  )() as typeof waitForStartup
  let now = 0
  await expect(
    browserWait(
      () => ({ ready: false, progress: 'Downloading:334/1024' }),
      FIRST_FOLDER_STALL_MS,
      async () => {
        now += 1000
      },
      () => now,
      firstFolderBudget(1024)
    )
  ).rejects.toThrow('progress stalled')
  expect(now).toBe(FIRST_FOLDER_STALL_MS)
  expect(now).toBeLessThan(firstFolderBudget(1024))
})

it('honors the caller deadline even while progress keeps advancing', async () => {
  let now = 0
  await expect(
    waitForStartup(
      () => ({ ready: false, progress: String(now) }),
      30000,
      async () => {
        now += 1000
        if (now > 120000) throw new Error('wait exceeded its budget')
      },
      () => now,
      120000
    )
  ).rejects.toThrow('deadline')
  expect(now).toBe(120000)
})

it('runs the same self-contained wait when serialized into the phone evaluator', async () => {
  const browserWait = new Function(
    STARTUP_WAIT + ';return waitForStartup'
  )() as typeof waitForStartup
  let now = 0
  await browserWait(
    () => ({ ready: now >= 60000, progress: String(now / 10000) }),
    30000,
    async () => {
      now += 10000
    },
    () => now
  )
  expect(now).toBe(60000)
})

it('allows a cold inspection beyond twenty seconds while actual progress advances', async () => {
  let now = 0
  await waitForStartup(
    () => ({ ready: now >= 100000, progress: String(Math.floor(now / 10000)) }),
    30000,
    async () => {
      now += 1000
    },
    () => now
  )
  expect(now).toBe(100000)
})
it('fails when progress stalls even if elapsed timings keep changing', async () => {
  let now = 0
  await expect(
    waitForStartup(
      () => ({ ready: false, progress: 'Checking the vault:8/12' }),
      30000,
      async () => {
        now += 1000
      },
      () => now
    )
  ).rejects.toThrow('stalled')
  expect(now).toBe(30000)
})
it('surfaces a product error immediately', async () => {
  await expect(
    waitForStartup(() => ({ ready: false, progress: '', error: 'Opening sync storage failed' }))
  ).rejects.toThrow('Opening sync storage')
})
