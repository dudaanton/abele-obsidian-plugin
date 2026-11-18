// @vitest-environment node
import { expect, it } from 'vitest'
import {
  scrollBlocking,
  ownScrollTaskCpu,
  boundedScrollStall,
  stopScrollGuards,
} from '../e2e/helpers/scrollBlocking'
import { inputFrameClock } from '../e2e/helpers/inputFrameClock'
import { createRequire } from 'node:module'

it('does not recurse when formatting a caller stack uses a guarded host API', () => {
  const evidence = scrollBlocking()
  const primitive = { block: () => 'done' }
  const original = Error.prepareStackTrace
  let formatted = 0
  evidence.wrap(primitive, 'block')
  Error.prepareStackTrace = () => {
    formatted++
    primitive.block()
    return 'Error\nwrapper\nplugin:abele/scroll-regression'
  }
  const plugin = new Function(
    'primitive',
    'return () => primitive.block()\n//# sourceURL=plugin:abele/scroll-regression'
  )(primitive)
  try {
    expect(plugin()).toBe('done')
    expect(evidence.calls).toHaveLength(1)
    expect(formatted).toBe(0)
  } finally {
    Error.prepareStackTrace = original
    evidence.stop()
  }
})

it('preserves callable properties and rolls back a partially installed guard', () => {
  const evidence = scrollBlocking()
  const original = Object.assign(() => {}, { native: () => 'native' })
  const fs = { realpathSync: original }
  expect(() =>
    evidence.install((name) => {
      if (name === 'node:fs') return fs
      throw Error('setup failed')
    })
  ).toThrow('setup failed')
  expect(fs.realpathSync).toBe(original)
  evidence.wrap(fs, 'realpathSync')
  expect(fs.realpathSync.native()).toBe('native')
  evidence.stop()
  evidence.stop()
  expect(fs.realpathSync).toBe(original)
})

it('restores the other APIs even when one restoration fails and reports the failure', () => {
  const evidence = scrollBlocking()
  const first = { block() {} }
  const original = first.block
  const second = { block() {} }
  const descriptor = Object.getOwnPropertyDescriptor(second, 'block')!
  let fail = false
  const proxy = new Proxy(second, {
    defineProperty(target, key, value) {
      if (fail) throw Error('restore failed')
      return Reflect.defineProperty(target, key, value)
    },
  })
  evidence.wrap(first, 'block')
  evidence.wrap(proxy, 'block')
  fail = true
  try {
    evidence.stop()
    expect(first.block).toBe(original)
    expect(stopScrollGuards()).toEqual(['Error: restore failed'])
  } finally {
    fail = false
    Object.defineProperty(second, 'block', descriptor)
  }
})

it('detects the bounded in-process wait used by the live regression and restores the APIs', () => {
  const requireModule = createRequire(import.meta.url)
  const child = requireModule('node:child_process')
  const original = child.execFileSync
  const evidence = scrollBlocking()
  const pause = { wait: boundedScrollStall }
  const handler = new Function(
    'pause',
    `return () => pause.wait()
    //# sourceURL=plugin:abele/scroll-regression`
  )(pause)
  try {
    evidence.install((name) => (name === 'electron' ? {} : requireModule(name)))
    evidence.wrap(pause, 'wait')
    const start = performance.now()
    handler()
    expect(performance.now() - start).toBeGreaterThanOrEqual(250)
    expect(evidence.calls.map((call) => call.operation)).toContain('wait')
  } finally {
    evidence.stop()
  }
  expect(child.execFileSync).toBe(original)
  expect(pause.wait).toBe(boundedScrollStall)
})

it('independently restores a guard after an interrupted case and disables retained wrappers', () => {
  const requireModule = createRequire(import.meta.url)
  const evidence = scrollBlocking()
  const primitive = { block: () => 'done' }
  const original = primitive.block
  evidence.install((name) => (name === 'electron' ? {} : requireModule(name)))
  evidence.wrap(primitive, 'block')
  const retained = primitive.block
  // Simulate a probe abandoning its own cleanup; the after-case cleanup is independent.
  expect(stopScrollGuards()).toEqual([])
  expect(primitive.block).toBe(original)
  const plugin = new Function(
    'call',
    'return () => call()\n//# sourceURL=plugin:abele/scroll-regression'
  )(retained)
  expect(plugin()).toBe('done')
  expect(evidence.calls).toEqual([])
  expect(stopScrollGuards()).toEqual([])
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

it('fails opt-in attribution when any long task has no samples, even if other tasks do', () => {
  const profile = {
    startTime: 0,
    nodes: [{ id: 1, callFrame: { url: 'app://obsidian.md/app.js' } }],
    samples: [1],
    timeDeltas: [10000],
  }
  const tasks = [
    { start: 0, duration: 60 },
    { start: 100, duration: 250 },
  ]
  expect(() => ownScrollTaskCpu(profile, tasks, 0, 0.5, true)).toThrow(
    /unknown.*no profile samples/i
  )
  expect(ownScrollTaskCpu(profile, tasks, 0)).toBe(0)
  expect(ownScrollTaskCpu(profile, [tasks[0]], 0, 0.5, true)).toBe(0)
})
