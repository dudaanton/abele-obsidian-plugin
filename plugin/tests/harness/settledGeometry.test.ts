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
