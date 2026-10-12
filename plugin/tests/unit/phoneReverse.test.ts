import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(() => '{"reverse":[54321]}'),
}))
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, ...calls, default: { ...actual, ...calls } }
})
import { exposeToPhone, waitForPhoneRoute, phoneReverseStatus } from '../e2e/helpers/phone'
it('reports only reverse membership and never raw driver status or errors', () => {
  calls.execFileSync.mockReturnValueOnce('{"reverse":[54321],"credential":"private"}')
  expect(phoneReverseStatus(54321)).toBe('listed')
  calls.execFileSync.mockReturnValueOnce('{"reverse":[]}')
  expect(phoneReverseStatus(54321)).toBe('absent')
  calls.execFileSync.mockImplementationOnce(() => {
    throw new Error('Bearer private')
  })
  expect(phoneReverseStatus(54321)).toBe('unavailable')
})
it('retries authenticated readiness and keeps only a sanitized probe error', async () => {
  const probe = vi.fn().mockRejectedValueOnce(new Error('route not ready')).mockResolvedValue(true)
  await waitForPhoneRoute(probe)
  expect(probe).toHaveBeenCalledTimes(2)
  await expect(
    waitForPhoneRoute(async () => {
      throw new Error('route https://secret.example Bearer secret-token; observed credentials')
    }, 0)
  ).rejects.toThrow('Phone authenticated route readiness failed: route [address] [credential]')
})
it('awaits the owned reverse exit before allowing a replacement on the same port', async () => {
  const first = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    exitCode: null,
    signalCode: null,
  })
  const second = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    exitCode: null,
    signalCode: null,
  })
  calls.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second)
  const stop = await exposeToPhone(54321)
  const closing = stop()
  let opened = false
  const replacement = Promise.resolve(exposeToPhone(54321)).then((value) => {
    opened = true
    return value
  })
  await Promise.resolve()
  expect(opened).toBe(false)
  expect(calls.spawn).toHaveBeenCalledTimes(1)
  first.emit('exit', 0)
  await closing
  const stopSecond = await replacement
  expect(calls.spawn).toHaveBeenCalledTimes(2)
  const done = stopSecond()
  second.emit('exit', 0)
  await done
})
