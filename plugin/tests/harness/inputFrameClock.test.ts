import { expect, it } from 'vitest'
import { inputFrameClock } from '../e2e/helpers/inputFrameClock'

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
