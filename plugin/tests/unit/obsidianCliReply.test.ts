// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let defaultCli: typeof import('../e2e/helpers/obsidianCli') | undefined

async function withCli(
  work: (
    cli: Awaited<ReturnType<(typeof import('../e2e/helpers/obsidianCli'))['vaultCli']>>,
    pid: () => number,
    effects: () => number
  ) => void | Promise<void>
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'abele-cli-reply-'))
  const executable = join(dir, 'sample-cli')
  const pid = join(dir, 'child.pid')
  writeFileSync(
    executable,
    `#!/usr/bin/env node
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
    await withCli((cli, pid) => {
      expect(cli.evalAwait("'ok'", 1000)).toBe('ok')
      expect(gone(pid())).toBe(true)
    })
  })

  it('ignores misleading log arrows and preserves JSON, null, and raw multi-line strings', async () => {
    await withCli((cli) => {
      expect(cli.evalAwait('({ count: 2, text: "an arrow => in data" })', 1000)).toEqual({
        count: 2,
        text: 'an arrow => in data',
      })
      expect(cli.evalAwait('null', 1000)).toBeNull()
      expect(cli.evalRaw('"first\\nsecond"', 1000)).toBe('first\nsecond')
      expect(cli.evalRaw('({ count: 2 })', 1000)).toBe('{\n  "count": 2\n}')
    })
  })

  it('does not accept a log as a missing reply, and kills the child on the unchanged deadline', async () => {
    await withCli(async (cli, pid) => {
      expect(() => cli.evalAwait('new Promise(() => {})', 1000)).toThrow(/gave no answer/)
      // The outer deadline can kill the proxy before it reaps its CLI child. SIGKILL
      // is asynchronous; allow OS cleanup, but never accept a surviving child.
      await expect.poll(() => gone(pid()), { timeout: 1000, interval: 10 }).toBe(true)
    })
  })

  it('frames the default setup/teardown evals too, without replaying side effects', async () => {
    await withCli((_vault, pid, effects) => {
      // A fixture CLI never exits by itself; logs contain a misleading reply nonce.
      // Each public helper must wait for its own completed reply and kill the child.
      const cli = defaultCli!
      expect(cli.evalRaw('"setup\\ncomplete"', 1000)).toBe('setup\ncomplete')
      expect(cli.evalRawIdempotent('"cleanup"', 1000)).toBe('cleanup')
      expect(cli.evalJson('({ count: 3 })', 1000)).toEqual({ count: 3 })
      expect(cli.evalJsonIdempotent('null', 1000)).toBeNull()
      expect(
        cli.evalRaw(
          `(() => { require('fs').appendFileSync(process.argv[1] + '.effects', 'once\\n'); return 'done' })()`,
          1000
        )
      ).toBe('done')
      expect(effects()).toBe(1)
      expect(cli.evalRaw('Promise.reject(new Error("Sample setup failure"))', 1000)).toBe(
        'Error: Sample setup failure'
      )
      expect(gone(pid())).toBe(true)
    })
  })

  it('still rejects an undefined JSON result rather than silently passing an empty probe', async () => {
    await withCli((cli) => {
      expect(() => cli.evalAwait('undefined', 1000)).toThrow(/undefined/)
    })
  })
})
