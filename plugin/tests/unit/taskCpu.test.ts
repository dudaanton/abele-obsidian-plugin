// @vitest-environment node
import { expect, it } from 'vitest'
import { TaskCpu } from '../helpers/taskCpu'

function spend(milliseconds: number): void {
  const usage = (
    process as NodeJS.Process & {
      threadCpuUsage(): { user: number; system: number }
    }
  ).threadCpuUsage.bind(process)
  const start = usage()
  for (;;) {
    const now = usage()
    if (now.user + now.system - start.user - start.system >= milliseconds * 1000) return
  }
}

it('excludes a parked thread but includes synchronous work and promise continuations', async () => {
  const parked = new TaskCpu()
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80)
  parked.stop()
  expect(parked.longestWallMs).toBeGreaterThanOrEqual(50)
  expect(parked.longestMs).toBeLessThan(50)

  const blocked = new TaskCpu()
  try {
    for (let i = 0; i < 6; i++) {
      spend(10)
      await Promise.resolve()
    }
  } finally {
    blocked.stop()
  }
  expect(blocked.longestMs).toBeGreaterThanOrEqual(50)
})

it('starts a fresh CPU allowance only after a real host task boundary', async () => {
  const monitor = new TaskCpu()
  try {
    for (let i = 0; i < 6; i++) {
      spend(10)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  } finally {
    monitor.stop()
  }
  expect(monitor.tasks).toBeGreaterThanOrEqual(6)
  expect(monitor.longestMs).toBeLessThan(50)
})

it('does not renew the CPU allowance for queueMicrotask continuations', async () => {
  const monitor = new TaskCpu()
  try {
    for (let i = 0; i < 6; i++) {
      spend(10)
      await new Promise<void>((resolve) => queueMicrotask(resolve))
    }
  } finally {
    monitor.stop()
  }
  expect(monitor.longestMs).toBeGreaterThanOrEqual(50)
})
