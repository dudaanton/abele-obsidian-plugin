import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

it('preserves recovery bytes and their durable owner during ordinary readiness evaluation', async () => {
  const source = readFileSync('tests/e2e/helpers/phoneHost.ts', 'utf8')
  const start = source.indexOf('`(async () => {', source.indexOf('let matches = false'))
  const end = source.indexOf('`,', start)
  const body = source
    .slice(start + 1, end)
    .replace('${JSON.stringify(PHONE_VAULT)}', JSON.stringify('sample-pool'))
    .replace('${JSON.stringify(hashes)}', '{}')
  // Evaluate the real fast readiness body with a cut install's bytes and owner.
  const bytes = new Set(['.obsidian/plugins/abele/sync-staging/sample.incoming'])
  const owner = { target: 'Notes/sample.md', temp: [...bytes][0] }
  const app = {
    vault: {
      configDir: '.obsidian',
      getName: () => 'sample-pool',
      adapter: {
        exists: async (path: string) => [...bytes].some((one) => one.startsWith(path)),
        rmdir: async (path: string) => {
          for (const one of bytes) if (one.startsWith(path)) bytes.delete(one)
        },
      },
    },
    plugins: {},
  }
  const api = {}
  const page = { __abeleTest: api, __e2eInstalledBuild: { api, generation: 1, hashes: {} } }
  // The pre-fix deletion helper is intentionally supplied if still embedded.
  const helper = /const CLEAR_SYNC_RECOVERY = `([\s\S]*?)`/.exec(source)?.[1] ?? 'async () => false'
  const evaluate = new Function(
    'app',
    'window',
    'performance',
    `return ${body.replace('${CLEAR_SYNC_RECOVERY}', helper)}`
  )
  await evaluate(app, page, { timeOrigin: 1 })
  expect(bytes.has(owner.temp)).toBe(true)
  expect(owner.target).toBe('Notes/sample.md')
})
