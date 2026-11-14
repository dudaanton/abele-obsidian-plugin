import { expect, it } from 'vitest'
import { PAIRED_POLLING } from '../e2e/helpers/pairedPolling'

function poll() {
  let time = 0
  let ready = false
  const until = new Function('performance', 'Date', 'wait', `${PAIRED_POLLING};return until`)(
    { now: () => time },
    { now: () => time },
    async () => {
      time = 100
      ready = true
    }
  )
  return { until, ready: () => ready }
}

it('checks the completed state after a delayed timer wakes at the deadline', async () => {
  const { until, ready } = poll()
  await expect(until(ready, 'Completed streamed turn', 100)).resolves.toBe(true)
})

it('still fails at the deadline when the requested state is absent', async () => {
  const { until } = poll()
  await expect(until(() => false, 'Compaction', 100)).rejects.toThrow('Compaction did not happen')
})

it('uses elapsed monotonic time when the wall clock changes during a turn', async () => {
  let elapsed = 0
  let wall = 0
  let checks = 0
  const until = new Function('performance', 'Date', 'wait', `${PAIRED_POLLING};return until`)(
    { now: () => elapsed },
    { now: () => wall },
    async () => {
      elapsed += 25
      wall += 120_000
    }
  )
  await expect(until(() => ++checks === 3, 'Completed streamed turn', 100)).resolves.toBe(true)
  expect(elapsed).toBe(50)
})
