import { expect, it } from 'vitest'
import { TIMELINE_POSITION_PROBE } from '../e2e/helpers/timelinePosition'

const { settleTimelinePosition } = new Function(
  `${TIMELINE_POSITION_PROBE}; return { settleTimelinePosition }`
)() as {
  settleTimelinePosition: (
    measure: () => number,
    position: () => void,
    frame: () => Promise<void>,
    limit?: number
  ) => Promise<void>
}

it('repositions a fixture row after lazy title growth before choosing it as the read anchor', async () => {
  let offset = 240
  let frames = 0
  let positions = 0
  await settleTimelinePosition(
    () => offset,
    () => {
      offset = 0
      positions++
    },
    async () => {
      frames++
      if (frames === 6) offset += 96
    }
  )
  expect(offset).toBe(0)
  expect(positions).toBe(2)
  expect(frames).toBeGreaterThanOrEqual(16)
})

it('does not count briefly aligned geometry as settled when it keeps drifting', async () => {
  let offset = 0
  await expect(
    settleTimelinePosition(
      () => offset,
      () => {
        offset = 0
      },
      async () => {
        offset += 24
      },
      12
    )
  ).rejects.toThrow('timeline fixture row did not settle')
})

it('leaves already settled positioning alone', async () => {
  let positions = 0
  await settleTimelinePosition(
    () => 0.25,
    () => {
      positions++
    },
    async () => {}
  )
  expect(positions).toBe(0)
})
