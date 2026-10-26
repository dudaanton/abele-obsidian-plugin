import { afterEach, expect, it, vi } from 'vitest'
import { waitNodeCommand } from '@/node/waitNodeCommand'

afterEach(() => vi.useRealTimers())
const schedule = (callback: () => void, milliseconds: number) => {
  const timer = setTimeout(callback, milliseconds)
  return () => clearTimeout(timer)
}
const receipt = { session_id: 'sample-context', run_id: 'sample-run', state: 'running' }

it('waits through approval and a slow command and returns its final output and exit code', async () => {
  vi.useFakeTimers()
  const final = {
    ...receipt,
    state: 'exited',
    exit_code: 7,
    stdout: 'final tail',
    stdout_truncated: true,
  }
  const read = vi.fn(async () => (Date.now() < 90_000 ? receipt : final))
  vi.setSystemTime(0)
  let settled = false
  const result = waitNodeCommand(
    { ...receipt, state: 'pending_approval' },
    { read, cancel: vi.fn(), schedule, guard: vi.fn() }
  ).then((value) => {
    settled = true
    return value
  })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(await result).toEqual(final)
})

it('reads the same run after a transient disconnect without resubmitting it', async () => {
  vi.useFakeTimers()
  const final = { ...receipt, state: 'exited', exit_code: 0, stdout: 'finished' }
  const read = vi.fn().mockRejectedValueOnce(new Error('disconnected')).mockResolvedValue(final)
  const result = waitNodeCommand(receipt, { read, cancel: vi.fn(), schedule, guard: vi.fn() })
  await vi.advanceTimersByTimeAsync(2000)
  expect(await result).toEqual(final)
  expect(read).toHaveBeenLastCalledWith(receipt)
})

it('cancels that run promptly when the chat stops during a status request', async () => {
  const controller = new AbortController()
  const cancel = vi.fn(async () => {})
  const read = vi.fn(() => new Promise<never>(() => {}))
  const result = waitNodeCommand(receipt, {
    read,
    cancel,
    schedule,
    guard: vi.fn(),
    signal: controller.signal,
  })
  const rejected = expect(result).rejects.toThrow(/cancel/i)
  controller.abort()
  await rejected
  expect(cancel).toHaveBeenCalledWith(receipt)
})

it('reports an explicit unfinished receipt at the wait limit', async () => {
  vi.useFakeTimers()
  const result = waitNodeCommand(receipt, {
    read: vi.fn(async () => receipt),
    cancel: vi.fn(),
    schedule,
    guard: vi.fn(),
  })
  await vi.advanceTimersByTimeAsync(600_000)
  expect(await result).toMatchObject({
    ...receipt,
    wait_expired: true,
    instruction: expect.stringContaining('node_command_status'),
  })
})

it('does not time out while the owner is still deciding', async () => {
  vi.useFakeTimers()
  const pending = { ...receipt, state: 'pending_approval' }
  const read = vi.fn(async () => pending)
  const controller = new AbortController()
  let settled = false
  const result = waitNodeCommand(pending, {
    read,
    cancel: vi.fn(async () => {}),
    schedule,
    guard: vi.fn(),
    signal: controller.signal,
  }).finally(() => {
    settled = true
  })
  const rejected = expect(result).rejects.toThrow(/cancel/i)
  await vi.advanceTimersByTimeAsync(660_000)
  expect(settled).toBe(false)
  controller.abort()
  await rejected
})

it('finishes stopping even when the disconnected node cannot acknowledge cancellation', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const result = waitNodeCommand(receipt, {
    read: () => new Promise<never>(() => {}),
    cancel: () => new Promise<never>(() => {}),
    schedule,
    guard: vi.fn(),
    signal: controller.signal,
  })
  const rejected = expect(result).rejects.toThrow(/cancel/i)
  controller.abort()
  await vi.advanceTimersByTimeAsync(5000)
  await rejected
})

it('returns denial without executing a replacement', async () => {
  const denied = { ...receipt, state: 'denied' }
  const cancel = vi.fn()
  expect(
    await waitNodeCommand(
      { ...receipt, state: 'pending_approval' },
      {
        read: async () => denied,
        cancel,
        schedule,
        guard: vi.fn(),
      }
    )
  ).toEqual(denied)
  expect(cancel).not.toHaveBeenCalled()
})
