import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const callbacks = () => {
  const tasks: Array<() => void> = []
  return { tasks, schedule: vi.fn((task: () => void) => tasks.push(task)) }
}

function load(name: string, globals: Record<string, unknown>) {
  const code = buildSync({
    entryPoints: [`src/shims/${name}.ts`],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'shim',
  }).outputFiles[0].text
  return runInNewContext(
    `const window = globalThis; ${code}; ({ exports: shim, host: window })`,
    globals
  )
}

describe('ZIP scheduling shims', () => {
  it('runs immediate callbacks asynchronously in FIFO batches, including nested callbacks', () => {
    const micro = callbacks()
    const { exports } = load('immediate', { queueMicrotask: micro.schedule })
    const seen: string[] = []
    exports.default(() => {
      seen.push('first')
      exports.default(() => seen.push('nested'))
    })
    exports.default(() => seen.push('second'))
    micro.schedule(() => seen.push('other microtask'))
    expect(seen).toEqual([])
    expect(micro.tasks).toHaveLength(2)
    micro.tasks.shift()!()
    expect(seen).toEqual(['first', 'second', 'nested'])
    micro.tasks.shift()!()
    expect(seen).toEqual(['first', 'second', 'nested', 'other microtask'])
    exports.default(() => seen.push('later'))
    expect(seen).toHaveLength(4)
    micro.tasks.shift()!()
    expect(seen.at(-1)).toBe('later')
  })

  it('falls back to a timer when queueMicrotask is unavailable', () => {
    const timers = callbacks()
    const { exports } = load('immediate', { setTimeout: timers.schedule })
    const task = vi.fn()
    exports.default(task)
    expect(task).not.toHaveBeenCalled()
    timers.tasks.shift()!()
    expect(task).toHaveBeenCalledOnce()
    expect(timers.schedule).toHaveBeenCalledWith(expect.any(Function), 0)
  })

  it('does not strand the immediate queue after a callback throws', () => {
    const micro = callbacks()
    const { exports } = load('immediate', { queueMicrotask: micro.schedule })
    const next = vi.fn()
    exports.default(() => {
      throw new Error('sample failure')
    })
    exports.default(next)
    expect(() => micro.tasks.shift()!()).toThrow('sample failure')
    micro.tasks.shift()!()
    expect(next).toHaveBeenCalledOnce()
  })

  it('leaves existing host setImmediate and clearImmediate untouched', () => {
    const setImmediate = vi.fn()
    const clearImmediate = vi.fn()
    const timers = callbacks()
    const { host } = load('setimmediate', {
      setImmediate,
      clearImmediate,
      setTimeout: timers.schedule,
    })
    expect(host.setImmediate).toBe(setImmediate)
    expect(host.clearImmediate).toBe(clearImmediate)
    expect(timers.schedule).not.toHaveBeenCalled()
  })

  it('provides asynchronous, cancellable task callbacks with arguments when absent', () => {
    const timers = callbacks()
    const micro = callbacks()
    const { host } = load('setimmediate', {
      setTimeout: timers.schedule,
      queueMicrotask: micro.schedule,
    })
    const seen: string[] = []
    const a = host.setImmediate((arg: string) => {
      seen.push(arg)
      host.setImmediate(() => seen.push('nested'))
    }, 'first')
    const b = host.setImmediate(() => seen.push('cancelled'))
    const c = host.setImmediate(() => seen.push('last'))
    expect(a).toBeGreaterThan(0)
    expect(new Set([a, b, c]).size).toBe(3)
    host.clearImmediate(b)
    expect(seen).toEqual([])
    expect(micro.tasks).toHaveLength(0)
    while (timers.tasks.length) timers.tasks.shift()!()
    expect(seen).toEqual(['first', 'last', 'nested'])
    host.clearImmediate(a)
    host.clearImmediate(999)
  })

  it('preserves a host clearImmediate even when installing a missing setImmediate', () => {
    const clearImmediate = vi.fn()
    const { host } = load('setimmediate', { clearImmediate, setTimeout: callbacks().schedule })
    expect(typeof host.setImmediate).toBe('function')
    expect(host.clearImmediate).toBe(clearImmediate)
  })

  it('does not lose later tasks when a setImmediate callback throws', () => {
    const timers = callbacks()
    const { host } = load('setimmediate', { setTimeout: timers.schedule })
    const next = vi.fn()
    host.setImmediate(() => {
      throw new Error('sample failure')
    })
    host.setImmediate(next)
    expect(() => timers.tasks.shift()!()).toThrow('sample failure')
    timers.tasks.shift()!()
    expect(next).toHaveBeenCalledOnce()
  })
})
