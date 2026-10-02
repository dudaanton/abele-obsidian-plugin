import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setBackgroundThrottling } from '../e2e/helpers/obsidianCli'

const exec = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ default: { execFileSync: exec }, execFileSync: exec }))
vi.mock('../e2e/helpers/target', () => ({ onPhone: () => false }))
beforeEach(() => exec.mockReset())
afterEach(() => exec.mockReset())

it('retries a lost reply when setting background throttling after a reload', () => {
  exec
    .mockImplementationOnce(() => {
      throw { code: 'ETIMEDOUT', signal: 'SIGKILL' }
    })
    .mockReturnValue('=> ok')
  expect(() => setBackgroundThrottling(false)).not.toThrow()
  expect(exec).toHaveBeenCalledTimes(2)
  const [first, retry] = exec.mock.calls
  expect(first[1]).toEqual(retry[1])
  expect(first[2].timeout + retry[2].timeout).toBeLessThan(45_000)
})

it('does not retry an actual command error', () => {
  exec.mockImplementation(() => {
    throw new Error('remote unavailable')
  })
  expect(() => setBackgroundThrottling(false)).toThrow('remote unavailable')
  expect(exec).toHaveBeenCalledOnce()
})

it('still fails if the retried throttling calls also get no reply', () => {
  exec.mockImplementation(() => {
    throw { code: 'ETIMEDOUT', signal: 'SIGKILL' }
  })
  expect(() => setBackgroundThrottling(false)).toThrow(/gave no answer.*3 attempts/)
  expect(exec).toHaveBeenCalledTimes(3)
})
