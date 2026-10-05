import { expect, it, vi } from 'vitest'
import { stagedNativeControl } from '../helpers/stagedNativeControl'

it('prepares a settled hit before one host-native tap, then measures fresh focus geometry', async () => {
  const order: string[] = []
  const tap = vi.fn(async () => {
    order.push('tap')
    return { ok: true }
  })
  const result = await stagedNativeControl({
    prepare: async () => {
      order.push('prepare')
      return { x: 50, y: 80, hit: true }
    },
    tap,
    measure: async (_point, ack) => {
      order.push('measure')
      return { focused: true, nativeKeyboard: 336, acknowledged: ack.ok }
    },
  })
  expect(order).toEqual(['prepare', 'tap', 'measure'])
  expect(tap).toHaveBeenCalledOnce()
  expect(result).toEqual({ focused: true, nativeKeyboard: 336, acknowledged: true })
})
it('never dispatches an offscreen/overlaid or nonfinite planned point', async () => {
  for (const point of [
    { x: 50, y: 80, hit: false },
    { x: NaN, y: 80, hit: true },
  ]) {
    const tap = vi.fn(async () => ({ ok: true }))
    await expect(
      stagedNativeControl({ prepare: async () => point, tap, measure: vi.fn() })
    ).rejects.toThrow(/hit prerequisite/i)
    expect(tap).not.toHaveBeenCalled()
  }
})
it('preserves a lost native reply as primary without measuring or replaying', async () => {
  const tap = vi.fn(async () => {
    throw new Error('sample native reply lost')
  })
  const measure = vi.fn()
  await expect(
    stagedNativeControl({ prepare: async () => ({ x: 50, y: 80, hit: true }), tap, measure })
  ).rejects.toThrow('sample native reply lost')
  expect(tap).toHaveBeenCalledOnce()
  expect(measure).not.toHaveBeenCalled()
})
it('rejects a negative acknowledgment without blessing later geometry', async () => {
  const tap = vi.fn(async () => ({ ok: false })),
    measure = vi.fn()
  await expect(
    stagedNativeControl({ prepare: async () => ({ x: 50, y: 80, hit: true }), tap, measure })
  ).rejects.toThrow(/unacknowledged/i)
  expect(tap).toHaveBeenCalledOnce()
  expect(measure).not.toHaveBeenCalled()
})
