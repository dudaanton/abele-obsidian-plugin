import { expect, it } from 'vitest'
import { TIMELINE_READY_PROBE } from '../e2e/helpers/timelineReady'

const settle = new Function(TIMELINE_READY_PROBE + 'return settleTimelineUI')()
it('waits for expected state and five stable geometry samples without correcting displacement', async () => {
  let polls = 0,
    position = 20,
    ready = false
  await settle(
    () => [position],
    () => ready,
    async (ms: number) => {
      expect(ms).toBe(100)
      polls++
      if (polls === 2) ready = true
      if (polls === 4) position = 21
    }
  )
  expect(polls).toBe(9)
  expect(position).toBe(21)
})
it('fails unsettled geometry and absent expected rows at the original readiness deadline', async () => {
  for (const available of [false, true]) {
    let polls = 0
    await expect(
      settle(
        () => [polls],
        () => available,
        async () => {
          polls++
        }
      )
    ).rejects.toThrow('did not settle')
    expect(polls).toBe(150)
  }
})
