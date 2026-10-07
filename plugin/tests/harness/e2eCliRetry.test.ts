import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import * as cli from '../e2e/helpers/obsidianCli'

const exec = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  default: { execFileSync: exec },
  execFileSync: exec,
}))
vi.mock('../e2e/helpers/target', () => ({ onPhone: () => false }))
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  const tmpdir = () => join(process.cwd(), 'node_modules')
  // Only the lock directory is test-owned. Keep real CLI-discovery exports, including
  // homedir, so an unset OBSIDIAN_CLI behaves the same as an ordinary checkout/CI host.
  return { ...original, default: { ...original.default, tmpdir }, tmpdir }
})

const noAnswer = () => Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', signal: 'SIGKILL' })

beforeEach(() => {
  exec.mockReset()
  vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out')
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(join(process.cwd(), 'node_modules/abele-e2e-reload.lock'), {
    recursive: true,
    force: true,
  })
})

describe('explicitly idempotent CLI calls', () => {
  it('isolates only the reload-lock directory while preserving CLI-discovery OS exports', async () => {
    const os = await import('node:os')
    expect(os.tmpdir()).toBe(join(process.cwd(), 'node_modules'))
    expect(os.default.tmpdir()).toBe(os.tmpdir())
    expect(os.homedir()).toBe(os.default.homedir())
    expect(os.homedir()).toEqual(expect.any(String))
  })

  it('repeats the exact read after a lost answer', () => {
    exec
      .mockImplementationOnce(() => {
        throw noAnswer()
      })
      .mockReturnValueOnce('=> [1280,800]')
    expect(cli.evalJsonIdempotent('getSize()')).toEqual([1280, 800])
    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec.mock.calls[1][1]).toEqual(exec.mock.calls[0][1])
  })

  it('bounds a never-answering call, names the attempt count and stays below the worker ceiling', () => {
    exec.mockImplementation(() => {
      throw noAnswer()
    })
    expect(() => cli.evalRawIdempotent('setSize()')).toThrow(/no answer.*3 attempts/)
    expect(exec).toHaveBeenCalledTimes(3)
    const blocked = exec.mock.calls.reduce((ms, call) => ms + call[2].timeout, 0)
    expect(blocked).toBeLessThan(60_000)
  })

  it('never repeats an arbitrary eval, reload, or native input after a lost answer', () => {
    for (const call of [
      () => cli.evalRaw('createNote()'),
      () => cli.reloadPlugin(),
      () => cli.runCli(['dev:cdp', 'method=Input.dispatchKeyEvent']),
    ]) {
      exec.mockReset().mockImplementation(() => {
        throw noAnswer()
      })
      expect(call).toThrow(/no answer.*1 attempt/)
      expect(exec).toHaveBeenCalledOnce()
    }
  })

  it('does not retry process failures or a returned script error', () => {
    exec.mockImplementationOnce(() => {
      throw Object.assign(new Error('failed'), { stderr: 'bad command' })
    })
    expect(() => cli.evalRawIdempotent('getSize()')).toThrow('bad command')
    expect(exec).toHaveBeenCalledOnce()
    exec.mockReset().mockReturnValue('Error: broken script')
    expect(cli.evalRawIdempotent('getSize()')).toBe('Error: broken script')
    expect(exec).toHaveBeenCalledOnce()
  })

  it('retries shared-key cleanup under the reload lock even when readiness fails', async () => {
    vi.useFakeTimers()
    let cleanup = 0
    let reads = 0
    let launches = 0
    const lock = join(process.cwd(), 'node_modules/abele-e2e-reload.lock')
    exec.mockImplementation((_bin, args) => {
      const code = args.join(' ')
      // Capture the owned old document before injecting the same invalid readiness answer.
      if (code.includes('performance.timeOrigin')) {
        if (reads++ === 0)
          return '=> {"owner":"sample-window","generation":100,"requestId":null,"mobile":false,"apiReady":true,"layoutReady":true}'
        return 'Error: invalid API probe'
      }
      if (code.includes('location.reload')) launches++
      if (code.includes('typeof window.__abeleTest')) return 'Error: invalid API probe'
      if (
        code.includes("localStorage.removeItem('EmulateMobile')") &&
        !code.includes('location.reload')
      ) {
        expect(readdirSync(lock)).toEqual([String(process.pid)])
        if (++cleanup === 1) throw noAnswer()
      }
      return '=> ok'
    })
    try {
      const result = cli.reloadApp().catch((error) => error)
      await vi.runAllTimersAsync()
      expect(await result).toBeInstanceOf(Error)
      expect((await result).message).toContain('Could not parse')
      expect(cleanup).toBe(2)
      expect(launches).toBe(1)
      expect(existsSync(lock)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not replay a process killed for a reason other than the call timeout', () => {
    exec.mockImplementation(() => {
      throw Object.assign(new Error('killed externally'), { signal: 'SIGKILL' })
    })
    expect(() => cli.evalRawIdempotent('getSize()')).toThrow('killed externally')
    expect(exec).toHaveBeenCalledOnce()
  })

  it('does not turn a missing CLI into a no-answer retry', () => {
    exec.mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })
    expect(() => cli.evalRawIdempotent('getSize()')).toThrow(cli.ObsidianUnavailableError)
    expect(exec).toHaveBeenCalledOnce()
  })

  it('retries job reads without replaying a long script or deleting its result before receiving it', async () => {
    vi.useFakeTimers()
    try {
      exec
        .mockReturnValueOnce('=> sample-job')
        .mockImplementationOnce(() => {
          throw noAnswer()
        })
        .mockReturnValueOnce('=> {"done":true,"out":"=> completed"}')
        .mockReturnValueOnce('=> ok')
      const result = cli.evalLong('createNotes()')
      await vi.runAllTimersAsync()
      await expect(result).resolves.toBe('completed')
      expect(exec).toHaveBeenCalledTimes(4)
      expect(exec.mock.calls[0][1].join(' ')).toContain('createNotes()')
      const poll = exec.mock.calls[1][1].join(' ')
      expect(poll).not.toContain('delete')
      expect(exec.mock.calls[2][1]).toEqual(exec.mock.calls[1][1])
      expect(exec.mock.calls[3][1].join(' ')).toContain('delete')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['Wide fixture did not render', 'Phone host transport (swipe): connection lost'])(
    'reports a rejected long probe before any feature JSON parser: %s',
    async (message) => {
      vi.useFakeTimers()
      try {
        exec
          .mockReturnValueOnce('=> sample-job')
          .mockReturnValueOnce('=> ' + JSON.stringify({ done: true, out: 'Error: ' + message }))
          .mockReturnValueOnce('=> ok')
        const result = cli.evalLong('probe()').catch((error) => error)
        await vi.runAllTimersAsync()
        expect(await result).toBeInstanceOf(Error)
        expect((await result).message).toContain(message)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it('waits for a settled test API instead of classifying one false probe as a missing build', async () => {
    vi.useFakeTimers()
    try {
      exec.mockReturnValueOnce('=> false').mockReturnValueOnce('=> true')
      const ready = cli.waitForTestApi(5000)
      await vi.runAllTimersAsync()
      await expect(ready).resolves.toBeUndefined()
      expect(exec).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves a transport failure when the test API never answers', async () => {
    exec.mockImplementation(() => {
      throw noAnswer()
    })
    await expect(cli.waitForTestApi(0)).rejects.toThrow(/test API.*no answer.*3 attempts/)
  })

  it('still rejects a settled window with no development API', async () => {
    exec.mockReturnValue('=> false')
    await expect(cli.waitForTestApi(0)).rejects.toThrow('development build')
  })
})
