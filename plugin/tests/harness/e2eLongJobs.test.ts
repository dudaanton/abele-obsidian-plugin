import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, '../e2e/helpers/obsidianCli.ts'), 'utf8')
const body = source.match(/export async function evalLong[\s\S]*?\n}\n/)![0].replace('export ', '')
const compiled = transformSync(body, { loader: 'ts', target: 'es2022' }).code

function fixture(lost: 'launch' | 'result') {
  const page = { starts: 0, __e2eJobs: {} }
  let launchLost = false,
    resultLost = false
  const evaluate = (code: string) => new Function('window', `return (${code})`)(page)
  const evalRaw = (code: string) => {
    const value = evaluate(code)
    if (lost === 'launch' && !launchLost) {
      launchLost = true
      throw Error('obsidian eval gave no answer in 30000 ms and was killed')
    }
    return value
  }
  const evalJson = (code: string) => {
    const value = evaluate(code)
    if (lost === 'result' && value?.done && !resultLost) {
      resultLost = true
      throw Error('obsidian eval gave no answer in 30000 ms and was killed')
    }
    return value
  }
  // The CLI layer owns the idempotent retry; evalLong must not add an outer budget.
  const idempotent = (call: (code: string) => unknown) => (code: string) => {
    try {
      return call(code)
    } catch (error) {
      if (!/gave no answer/.test(String(error))) throw error
      return call(code)
    }
  }
  const run = new Function(
    'evalRawIdempotent',
    'evalJsonIdempotent',
    'pauseAsync',
    'assertPhoneTransport',
    compiled + '; return evalLong'
  )(
    idempotent(evalRaw),
    idempotent(evalJson),
    () => new Promise((resolve) => setTimeout(resolve, 5)),
    () => {}
  ) as (code: string) => Promise<string>
  return { page, run }
}

describe('long eval jobs with a lost CLI reply', () => {
  it('preserves a page launch error instead of claiming the page reloaded', async () => {
    const run = new Function(
      'evalRawIdempotent',
      'evalJsonIdempotent',
      'pauseAsync',
      compiled + '; return evalLong'
    )(
      () => 'Error: invalid sample script',
      () => null,
      async () => {}
    ) as (code: string) => Promise<string>
    await expect(run('sample')).rejects.toThrow('invalid sample script')
  })
  for (const lost of ['launch', 'result'] as const) {
    it(`recovers a lost ${lost} reply without running the page action twice`, async () => {
      const f = fixture(lost)
      expect(await f.run(`(() => { window.starts++; return 'sample output' })()`)).toBe(
        'sample output'
      )
      expect(f.page.starts).toBe(1)
      expect(Object.keys(f.page.__e2eJobs)).toHaveLength(0)
    })
  }
})
