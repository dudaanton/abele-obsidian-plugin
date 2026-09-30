// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function withCli(
  work: (
    cli: Awaited<ReturnType<(typeof import('../e2e/helpers/obsidianCli'))['vaultCli']>>,
    pid: () => number
  ) => void
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'abele-cli-reply-'))
  const executable = join(dir, 'sample-cli')
  const pid = join(dir, 'child.pid')
  writeFileSync(
    executable,
    `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(pid)}, String(process.pid))
global.window = globalThis
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
    const { vaultCli } = await import('../e2e/helpers/obsidianCli')
    work(vaultCli('sample-vault'), () => Number(readFileSync(pid, 'utf8')))
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
    await withCli((cli, pid) => {
      expect(() => cli.evalAwait('new Promise(() => {})', 1000)).toThrow(/gave no answer/)
      expect(gone(pid())).toBe(true)
    })
  })

  it('still rejects an undefined JSON result rather than silently passing an empty probe', async () => {
    await withCli((cli) => {
      expect(() => cli.evalAwait('undefined', 1000)).toThrow(/undefined/)
    })
  })
})
