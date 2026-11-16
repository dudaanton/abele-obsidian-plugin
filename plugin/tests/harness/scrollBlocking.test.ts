// @vitest-environment node
import { expect, it } from 'vitest'
import { scrollBlocking } from '../e2e/helpers/scrollBlocking'
import { inputFrameClock } from '../e2e/helpers/inputFrameClock'

it('fails the scroll budget for a synchronous 250 ms wait in a plugin handler', () => {
  const evidence = scrollBlocking()
  const scrollHandler = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  const start = performance.now()
  scrollHandler()
  const duration = performance.now() - start
  const cpuOnly = inputFrameClock()
  cpuOnly.sample(0, 0, true)
  cpuOnly.sample(duration, 0.005, true)
  expect(cpuOnly.cpuMs).toBeLessThanOrEqual(90)
  // Browser script timing is supplied here; the synchronous wait itself is real.
  evidence.record([{ scripts: [{ sourceURL: 'plugin:abele', duration }] }])
  expect(() => expect(evidence.maxScriptMs).toBeLessThanOrEqual(90)).toThrow()
})

it('excludes host work and frame scheduling gaps but retains plugin synchronous pauses', () => {
  const evidence = scrollBlocking()
  evidence.record([
    { scripts: [{ sourceURL: 'app://obsidian.md/app.js', duration: 1000 }] },
    { scripts: [{ sourceURL: 'plugin:abele', duration: 5 }] },
  ])
  expect(evidence.maxScriptMs).toBe(5)
  evidence.record([{ scripts: [{ sourceURL: 'plugin:abele', duration: 5, pauseDuration: 250 }] }])
  expect(evidence.maxScriptMs).toBe(250)
})
