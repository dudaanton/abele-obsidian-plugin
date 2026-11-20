import { expect, it } from 'vitest'
import { settledGeometry } from '../helpers/settledGeometry'

it('does not retain a pre-focus rectangle while the keyboard and room reflow', async () => {
  let at = 0
  const read = () =>
    at < 200
      ? { focused: true, top: -12, bottom: 900, viewport: 844, keyboard: 0 }
      : { focused: true, top: 90, bottom: 400, viewport: 844, keyboard: 336 }
  const result = await settledGeometry(
    read,
    async () => {
      at += 50
    },
    () => at,
    1000,
    400
  )
  expect(result).toEqual({ focused: true, top: 90, bottom: 400, viewport: 844, keyboard: 336 })
  expect(at).toBeGreaterThanOrEqual(600)
})

it('does not mistake stable coordinates for stable viewport/keyboard geometry', async () => {
  let at = 0
  const result = await settledGeometry(
    () => ({ top: 90, bottom: 400, viewport: at < 250 ? 844 : 508 }),
    async () => {
      at += 50
    },
    () => at,
    1000,
    400
  )
  expect(result.viewport).toBe(508)
  expect(at).toBeGreaterThanOrEqual(650)
})

it('fails boundedly rather than blessing geometry that keeps moving', async () => {
  let at = 0
  await expect(
    settledGeometry(
      () => ({ top: at }),
      async () => {
        at += 50
      },
      () => at,
      500,
      400
    )
  ).rejects.toThrow(/geometry did not settle/i)
  expect(at).toBe(500)
})

it('waits for the phone footer to enter the viewport and rejects a permanently hidden action', async () => {
  for (const enters of [true, false]) {
    let at = 0
    const checked = settledGeometry(
      () => ({ bottom: enters && at >= 200 ? 820 : 900, viewport: 844 }),
      async () => {
        at += 50
      },
      () => at,
      1000,
      400,
      (sample) => sample.bottom <= sample.viewport
    )
    if (enters) {
      await expect(checked).resolves.toEqual({ bottom: 820, viewport: 844 })
      expect(at).toBeGreaterThanOrEqual(600)
    } else await expect(checked).rejects.toThrow(/geometry/i)
  }
})

it('does not measure a replacement catalogue sheet while a closing sheet remains', async () => {
  let at = 0
  const result = await settledGeometry(
    () => ({ count: at < 700 ? 2 : 1, height: 780, dismiss: 1 }),
    async () => {
      at += 50
    },
    () => at,
    1500,
    400,
    (sample) => sample.count === 1 && sample.height > 0
  )
  expect(result.count).toBe(1)
  expect(at).toBeGreaterThanOrEqual(1100)
})
