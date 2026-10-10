import { expect, it } from 'vitest'
import { waitForStartup, STARTUP_WAIT } from '../e2e/helpers/startupWait'

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
