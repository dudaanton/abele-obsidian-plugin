import { expect, it } from 'vitest'
import { inputFrameClock, assertInputFrameDelay } from '../e2e/helpers/inputFrameClock'

it('allows busy frames by default but fails a single 500 ms gesture gap', () => {
  expect(() => assertInputFrameDelay(248)).not.toThrow()
  expect(() => assertInputFrameDelay(499.9)).not.toThrow()
  expect(() => assertInputFrameDelay(500)).toThrow('500')
  expect(() => assertInputFrameDelay(750)).toThrow()
})

it('keeps the 90 ms frame budget confined to opt-in measurement', () => {
  expect(() => assertInputFrameDelay(90, true, 90)).not.toThrow()
  expect(() => assertInputFrameDelay(90.1, true, 90)).toThrow('90')
})

it('separates renderer CPU from a scheduling gap without excusing expensive frames', () => {
  const clock = inputFrameClock()
  clock.sample(0, 1, true)
  clock.sample(248, 1.008, true)
  expect(clock.wallMs).toBe(248)
  expect(clock.cpuMs).toBeCloseTo(8)
  clock.sample(350, 1.109, true)
  expect(clock.cpuMs).toBeCloseTo(101)
})

it('excludes idle and input queue time and requires CPU evidence', () => {
  const clock = inputFrameClock()
  clock.sample(0, 0, true)
  clock.sample(1000, 0.5, false)
  clock.sample(1100, 0.6, true)
  clock.sample(1116, 0.604, true)
  expect(clock.wallMs).toBe(16)
  expect(clock.cpuMs).toBeCloseTo(4)
  expect(() => clock.sample(1200, undefined, true)).toThrow('ThreadTime')
})
