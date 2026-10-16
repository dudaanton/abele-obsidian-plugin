import { expect, it } from 'vitest'
import { waitForStartup, STARTUP_WAIT, startupWaitFailure } from '../e2e/helpers/startupWait'
import { firstFolderBudget, FIRST_FOLDER_STALL_MS } from '../helpers/smallPullBounds'

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
