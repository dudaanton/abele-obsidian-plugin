// @vitest-environment node
import { expect, it } from 'vitest'
import { scrollBlocking, ownScrollTaskCpu } from '../e2e/helpers/scrollBlocking'
import { inputFrameClock } from '../e2e/helpers/inputFrameClock'
import { createRequire } from 'node:module'

it('detects the native process wait used by the live regression and restores the APIs', () => {
  const requireModule = createRequire(import.meta.url)
  const child = requireModule('node:child_process')
  const original = child.execFileSync
  const evidence = scrollBlocking()
  const handler = new Function(
    'require',
    `return () => require('node:child_process').execFileSync(
    require('node:process').execPath, ['-e', 'setTimeout(() => {}, 250)'], { timeout: 5000 })
    //# sourceURL=plugin:abele/scroll-regression`
  )(requireModule)
  try {
    evidence.install((name) => (name === 'electron' ? {} : requireModule(name)))
    handler()
    expect(evidence.calls.map((call) => call.operation)).toContain('execFileSync')
  } finally {
    evidence.stop()
  }
  expect(child.execFileSync).toBe(original)
})

it('fails the scroll budget for a synchronous 250 ms wait in a plugin handler', () => {
  const evidence = scrollBlocking()
  evidence.wrap(Atomics, 'wait')
  const scrollHandler = new Function(
    'return () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)\n//# sourceURL=plugin:abele/scroll-regression'
  )()
  const start = performance.now()
  try {
    scrollHandler()
  } finally {
    evidence.stop()
  }
  const duration = performance.now() - start
  const cpuOnly = inputFrameClock()
  cpuOnly.sample(0, 0, true)
  cpuOnly.sample(duration, 0.005, true)
  expect(cpuOnly.cpuMs).toBeLessThanOrEqual(90)
  expect(() => expect(evidence.calls).toEqual([])).toThrow()
  expect(evidence.calls).toHaveLength(1)
  expect(evidence.calls[0].operation).toBe('wait')
})

it('excludes blocking host calls beneath a plugin entry and detects plugin calls beneath a host entry', () => {
  const evidence = scrollBlocking()
  const primitive = { block() {} }
  const host = new Function('block', 'return () => block()\n//# sourceURL=app://obsidian.md/app.js')
  const plugin = new Function(
    'block',
    'return () => block()\n//# sourceURL=plugin:abele/scroll-regression'
  )
  evidence.wrap(primitive, 'block')
  try {
    plugin(host(primitive.block))()
    expect(evidence.calls).toEqual([])
    host(plugin(primitive.block))()
    expect(evidence.calls).toHaveLength(1)
  } finally {
    evidence.stop()
  }
})

it('bounds executing plugin samples, not host work or a descheduling gap', () => {
  const nodes = [
    { id: 1, callFrame: { url: 'plugin:abele' }, children: [2] },
    { id: 2, callFrame: { url: 'app://obsidian.md/app.js' }, children: [3] },
    { id: 3, callFrame: { url: 'plugin:abele' } },
  ]
  const profile = (id: number) => ({
    startTime: 0,
    nodes,
    samples: Array(500).fill(id),
    timeDeltas: Array(500).fill(500),
  })
  const tasks = [{ start: 0, duration: 300 }]
  expect(ownScrollTaskCpu(profile(2), tasks, 0)).toBe(0)
  expect(ownScrollTaskCpu(profile(3), tasks, 0)).toBe(250)
  expect(ownScrollTaskCpu({ ...profile(1), samples: [1], timeDeltas: [250000] }, tasks, 0)).toBe(
    0.5
  )
})
