// @vitest-environment node
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

it.each(['reader failure', 'deadline'])(
  'does not retain a late large result after abandonment by %s',
  async (failure) => {
    let release!: (value: string) => void
    const waiting = new Promise<string>((resolve) => {
      release = resolve
    })
    const page = { __e2eJobs: {} as Record<string, unknown> }
    const source = readFileSync(resolve(__dirname, '../e2e/helpers/obsidianCli.ts'), 'utf8')
    const body = source
      .match(/export async function evalLong[\s\S]*?\n}\n/)![0]
      .replace('export ', '')
    const compiled = transformSync(body, { loader: 'ts', target: 'es2022' }).code
    const evaluate = (code: string) =>
      runInNewContext(code, { window: page, waiting, setTimeout: (fn: () => void) => fn() })
    const run = new Function(
      'evalRawIdempotent',
      'evalJsonIdempotent',
      'pauseAsync',
      compiled + '; return evalLong'
    )(
      evaluate,
      () => {
        if (failure === 'deadline') return Object.values(page.__e2eJobs)[0]
        throw new Error('sample reader abandoned')
      },
      () => new Promise((resolve) => setTimeout(resolve, 1))
    ) as (code: string, timeoutMs?: number) => Promise<string>
    await expect(run('waiting', failure === 'deadline' ? 0 : 1000)).rejects.toThrow(
      failure === 'deadline' ? 'did not finish' : 'sample reader abandoned'
    )
    expect(Object.keys(page.__e2eJobs)).toEqual([])
    release('x'.repeat(1024 * 1024))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(Object.keys(page.__e2eJobs)).toEqual([])
  }
)
