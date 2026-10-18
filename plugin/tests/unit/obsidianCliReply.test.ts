// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let defaultCli: typeof import('../e2e/helpers/obsidianCli') | undefined
const processes = vi.hoisted(() => ({ spawnSync: vi.fn() }))
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  processes.spawnSync.mockImplementation(actual.spawnSync)
  return { ...actual, spawnSync: processes.spawnSync }
})

// These cases test framing and reaping, not how quickly two Node processes can start.
const IO_TIMEOUT = 30_000
afterEach(() => vi.useRealTimers())

async function withCli(
  work: (
    cli: Awaited<ReturnType<(typeof import('../e2e/helpers/obsidianCli'))['vaultCli']>>,
    pid: () => number,
    effects: () => number
  ) => void | Promise<void>,
  startupDelay = 0
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'abele-cli-reply-'))
  const executable = join(dir, 'sample-cli')
  const pid = join(dir, 'child.pid')
  writeFileSync(
    executable,
    `#!/usr/bin/env node
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${startupDelay})
require('fs').writeFileSync(${JSON.stringify(pid)}, String(process.pid))
global.window = globalThis
global.require = require
setInterval(() => {}, 1000)
const code = process.argv.find((arg) => arg.startsWith('code='))?.slice(5) || ''
process.stdout.write('=> ' + JSON.stringify({__abeleReply: 'not-this-request', hasValue: true, value: 'wrong'}) + '\\n')
Promise.resolve(eval(code)).then((reply) => {
  const output = '=> ' + String(reply) + '\\n'
  const split = Math.floor(output.length / 2)
  process.stdout.write(output.slice(0, split))
  setImmediate(() => process.stdout.write(output.slice(split)))
})
`
  )
  chmodSync(executable, 0o755)
  const before = process.env.OBSIDIAN_CLI
  process.env.OBSIDIAN_CLI = executable
  vi.resetModules()
  try {
    defaultCli = await import('../e2e/helpers/obsidianCli')
    const { vaultCli } = defaultCli
    await work(
      vaultCli('sample-vault'),
      () => Number(readFileSync(pid, 'utf8')),
      () =>
        readFileSync(executable + '.effects', 'utf8')
          .trim()
          .split('\n').length
    )
  } finally {
    if (before === undefined) delete process.env.OBSIDIAN_CLI
    else process.env.OBSIDIAN_CLI = before
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  }
}

function gone(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

describe('an Obsidian CLI reply independent of process exit', () => {
  it('accepts the completed eval reply when the CLI keeps its output pipe open', async () => {
    await withCli(async (cli, pid) => {
      expect(cli.evalAwait("'ok'", IO_TIMEOUT)).toBe('ok')
      await expect.poll(() => gone(pid()), { timeout: IO_TIMEOUT }).toBe(true)
    }, 1500)
  }, 60_000)

  it('ignores misleading log arrows and preserves JSON, null, and raw multi-line strings', async () => {
    await withCli((cli) => {
      expect(cli.evalAwait('({ count: 2, text: "an arrow => in data" })', IO_TIMEOUT)).toEqual({
        count: 2,
        text: 'an arrow => in data',
      })
      expect(cli.evalAwait('null', IO_TIMEOUT)).toBeNull()
      expect(cli.evalRaw('"first\\nsecond"', IO_TIMEOUT)).toBe('first\nsecond')
      expect(cli.evalRaw('({ count: 2 })', IO_TIMEOUT)).toBe('{\n  "count": 2\n}')
    })
  }, 180_000)

  it('does not accept a log as a missing reply, and kills the child on the unchanged deadline', async () => {
    await withCli(async (cli) => {
      vi.useFakeTimers()
      vi.setSystemTime(100_000)
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        pid: 123,
        exitCode: null,
        signalCode: null,
        kill: vi.fn(),
      })
      const output = { stdout: '', stderr: '' }
      const stream = (key: keyof typeof output) => ({
        write: (text: string, done: () => void) => {
          output[key] += text
          done()
        },
      })
      const exit = vi.fn()
      const source = readFileSync('tests/e2e/helpers/obsidianEvalProcess.mjs', 'utf8').replace(
        "import { spawn } from 'node:child_process'",
        ''
      )
      new Function('spawn', 'process', source)(() => child, {
        argv: ['node', 'proxy', 'sample-cli', 'request-nonce', '101000'],
        stdout: stream('stdout'),
        stderr: stream('stderr'),
        exit,
      })
      child.stdout.write('=> {"__abeleReply":"wrong-request","value":"log"}\n')
      // The proxy reserves 25 ms for reaping, within the original absolute deadline.
      await vi.advanceTimersByTimeAsync(974)
      expect(child.kill).not.toHaveBeenCalled()
      expect(exit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
      expect(exit).not.toHaveBeenCalled()
      child.emit('exit', null, 'SIGKILL')
      expect(exit).toHaveBeenCalledExactlyOnceWith(124)

      processes.spawnSync.mockReturnValueOnce({
        pid: 0,
        status: 124,
        signal: null,
        stdout: output.stdout,
        stderr: output.stderr,
      })
      expect(() => cli.evalAwait('new Promise(() => {})', 1000)).toThrow(
        /gave no answer in 1000 ms and was killed/
      )
      expect(processes.spawnSync).toHaveBeenLastCalledWith(
        process.execPath,
        expect.any(Array),
        expect.objectContaining({ timeout: 1000, killSignal: 'SIGKILL' })
      )
    })
  }, 60_000)

  it('frames the default setup/teardown evals too, without replaying side effects', async () => {
    await withCli(async (_vault, pid, effects) => {
      // A fixture CLI never exits by itself; logs contain a misleading reply nonce.
      // Each public helper must wait for its own completed reply and kill the child.
      const cli = defaultCli!
      expect(cli.evalRaw('"setup\\ncomplete"', IO_TIMEOUT)).toBe('setup\ncomplete')
      expect(cli.evalRawIdempotent('"cleanup"', IO_TIMEOUT)).toBe('cleanup')
      expect(cli.evalJson('({ count: 3 })', IO_TIMEOUT)).toEqual({ count: 3 })
      expect(cli.evalJsonIdempotent('null', IO_TIMEOUT)).toBeNull()
      expect(
        cli.evalRaw(
          `(() => { require('fs').appendFileSync(process.argv[1] + '.effects', 'once\\n'); return 'done' })()`,
          IO_TIMEOUT
        )
      ).toBe('done')
      expect(effects()).toBe(1)
      expect(cli.evalRaw('Promise.reject(new Error("Sample setup failure"))', IO_TIMEOUT)).toBe(
        'Error: Sample setup failure'
      )
      await expect.poll(() => gone(pid()), { timeout: IO_TIMEOUT }).toBe(true)
    })
  }, 240_000)

  it('still rejects an undefined JSON result rather than silently passing an empty probe', async () => {
    await withCli((cli) => {
      expect(() => cli.evalAwait('undefined', IO_TIMEOUT)).toThrow(/undefined/)
    })
  }, 60_000)
})
