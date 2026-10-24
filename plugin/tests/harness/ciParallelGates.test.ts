// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'

const workflow = (name: string): any =>
  load(readFileSync(`../.github/workflows/${name}.yml`, 'utf8'))
const checks = workflow('test')
const step = (job: string, name: string) =>
  checks.jobs[job]?.steps.find((entry: any) => entry.name === name)

// Execute workflow shell fragments against invented inputs, never the real gates.
function shell(command: string, env: Record<string, string> = {}, cwd?: string) {
  return execFileSync('bash', ['-e', '-o', 'pipefail', '-c', command], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim()
}

describe('parallel CI verification gates', () => {
  it('keeps every independent gate runnable without waiting for another gate', () => {
    expect(Object.keys(checks.jobs).sort()).toEqual(
      ['guard', 'lint', 'review', 'dependencies', 'test', 'types', 'build'].sort()
    )
    for (const job of ['guard', 'lint', 'review', 'dependencies', 'test', 'types']) {
      expect(checks.jobs[job].needs).toBeUndefined()
      expect(checks.jobs[job].if).toBeUndefined()
      expect(checks.jobs[job]['continue-on-error']).toBeUndefined()
      for (const entry of checks.jobs[job].steps) expect(entry['continue-on-error']).toBeUndefined()
    }
    expect(checks.jobs.build.needs).toBe('types')
    expect(step('guard', 'Repository guard').run).toContain('repo-guard.mjs --all')
    expect(step('guard', 'Repository guard').run).toContain('repo-guard.mjs --range')
    expect(step('dependencies', 'Audit shipped dependencies').run).toBe(
      'node scripts/audit-dependencies.mjs'
    )
    expect(step('dependencies', 'Dead-code inventory').run).toBe('node scripts/dead-code.mjs')
    expect(step('lint', 'Lint').run).toBe('npm run lint:ci')
    expect(step('lint', 'Lint').env.ABELE_LINT_CONCURRENCY).toBe('2')
    expect(step('review', "No suppressions of Obsidian's rules").run).toContain('lint:review')
    expect(step('types', 'Type check').run).toBe('npm run types')
    expect(step('build', 'Build production once').run).toBe('npm run build:verified')
    expect(step('build', 'Bundle size').run).toBe('npm run test:size')
    expect(step('build', 'Verify production release assets').run).toContain('check-release.mjs')
  })

  it('still rejects review suppression findings while ordinary review findings remain advisory', () => {
    const review = step('review', "No suppressions of Obsidian's rules").run
    const invoke = (output: string) =>
      shell(`npm() { printf '%s\\n' "$SAMPLE_OUTPUT"; return 1; }\n${review}`, {
        SAMPLE_OUTPUT: output,
      })
    expect(invoke('sample.ts: ordinary type warning')).toContain(
      "No suppressions of Obsidian's rules."
    )
    expect(() => invoke('sample.ts: eslint-comments/no-restricted-disable')).toThrow()
  })

  it('runs all four disjoint test shards without fail-fast cancellation or empty-suite bypasses', () => {
    expect(checks.jobs.test.strategy).toEqual({
      'fail-fast': false,
      matrix: { shard: [1, 2, 3, 4] },
    })
    const tests = step('test', 'Unit and integration tests')
    expect(tests.env.SHARD).toBe('${{ matrix.shard }}')
    expect(tests.env.SHARD_COUNT).toBe(4)
    expect(tests.run).not.toContain('passWithNoTests')
    for (const shard of checks.jobs.test.strategy.matrix.shard) {
      const output = shell(`npm() { printf '%s\\n' "$*"; }\n${tests.run}`, {
        TEST_SCOPE: 'all',
        SHARD: String(shard),
        SHARD_COUNT: String(tests.env.SHARD_COUNT),
      })
      expect(output).toBe(`test -- --shard=${shard}/4 --maxWorkers=2`)
    }
  })

  it('caches npm installations in every dependency-consuming job and still verifies the exact revision', () => {
    for (const [id, job] of Object.entries(checks.jobs) as [string, any][]) {
      const checkout = job.steps.find((entry: any) => entry.uses?.startsWith('actions/checkout@'))
      expect(checkout.with.ref).toBe('${{ inputs.revision || github.sha }}')
      expect(checkout.with['persist-credentials']).toBe(false)
      const verify = step(id, 'Verify exact revision')
      expect(verify.env.REVISION).toBe('${{ inputs.revision || github.sha }}')
      expect(verify.run).toContain('git rev-parse HEAD')
      expect(verify.run).toContain('[ "$REVISION" = "$GITHUB_SHA" ]')
      const node = job.steps.find((entry: any) => entry.uses?.startsWith('actions/setup-node@'))
      expect(node.with['node-version']).toBe('22.23.4')
      if (id === 'guard') continue
      expect(node.with.cache).toBe('npm')
      expect(node.with['cache-dependency-path']).toBe('plugin/package-lock.json')
      expect(step(id, 'Install dependencies').run).toBe('npm ci --ignore-scripts')
    }
  })

  it('binds the content cache to the complete input tree, lockfile, config and exact Node version without fallback', () => {
    const job = checks.jobs.lint
    const cache = job?.steps.find((entry: any) => entry.uses?.startsWith('actions/cache@'))
    expect(cache).toBeDefined()
    expect(cache.with.path).toBe('plugin/node_modules/.cache/eslint/ci')
    expect(cache.with['restore-keys']).toBeUndefined()
    expect(cache.with.key).toContain("hashFiles('plugin/package-lock.json')")
    expect(cache.with.key).toContain(
      "hashFiles('plugin/eslint.config.mjs', 'plugin/.prettierrc.mjs')"
    )
    expect(cache.with.key).toContain('steps.lint_inputs.outputs.tree')
    expect(cache.with.key).toContain('steps.node.outputs.node-version')
    expect(cache.with.key).toContain('runner.os')
    expect(cache.with.key).toContain('runner.arch')
    const fingerprint = step('lint', 'Fingerprint complete lint inputs')
    expect(fingerprint.id).toBe('lint_inputs')
    expect(fingerprint.run).toContain('git rev-parse HEAD^{tree}')
  })

  it('invalidates typed results when an imported declaration, manifest, config or input path changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'sample-ci-inputs-'))
    try {
      shell('git init -q', {}, root)
      const output = join(root, 'output')
      const fingerprint = step('lint', 'Fingerprint complete lint inputs')
      const tree = () => {
        shell(
          'git add inputs && git -c user.name=Example -c user.email=example@example.invalid commit -qm inputs',
          {},
          root
        )
        writeFileSync(output, '')
        shell(fingerprint.run, { GITHUB_OUTPUT: output }, root)
        return readFileSync(output, 'utf8')
      }
      mkdirSync(join(root, 'inputs'))
      writeFileSync(
        join(root, 'inputs/source.ts'),
        'import type { Sample } from "./imported"\nexport declare const sample: Sample\n'
      )
      writeFileSync(join(root, 'inputs/imported.d.ts'), 'export type Sample = string\n')
      const identities = [tree()]
      writeFileSync(join(root, 'inputs/imported.d.ts'), 'export type Sample = number\n')
      identities.push(tree())
      writeFileSync(join(root, 'inputs/manifest.json'), '{"version":"0.0.1"}\n')
      identities.push(tree())
      writeFileSync(join(root, 'inputs/eslint.config.mjs'), 'export default []\n')
      identities.push(tree())
      shell('git mv inputs/source.ts inputs/renamed.ts', {}, root)
      identities.push(tree())
      expect(new Set(identities).size).toBe(identities.length)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('runs the full lint configuration from the root with content caching and propagates failures', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts['lint:ci']).toBeDefined()
    const root = mkdtempSync(join(tmpdir(), 'sample-ci-lint-'))
    try {
      const bin = join(root, 'plugin/node_modules/eslint/bin')
      mkdirSync(bin, { recursive: true })
      const fake = join(bin, 'eslint.js')
      writeFileSync(
        fake,
        `console.log(JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2), exec: process.execArgv})); process.exit(Number(process.env.SAMPLE_EXIT || 0));`
      )
      const result = JSON.parse(
        shell(pkg.scripts['lint:ci'], { ABELE_LINT_CONCURRENCY: '2' }, join(root, 'plugin'))
      )
      expect(result.cwd).toBe(realpathSync(root))
      expect(result.exec).toContain('--max-old-space-size=8192')
      expect(result.args).toEqual([
        '--no-config-lookup',
        '--config',
        'plugin/eslint.config.mjs',
        '--concurrency',
        '2',
        '.',
        '--cache',
        '--cache-strategy',
        'content',
        '--cache-location',
        'plugin/node_modules/.cache/eslint/ci',
      ])
      expect(() =>
        shell(pkg.scripts['lint:ci'], { SAMPLE_EXIT: '1' }, join(root, 'plugin'))
      ).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires the entire reusable workflow before recording or publishing candidate evidence', () => {
    const candidate = workflow('release-candidate')
    expect(candidate.jobs.verify.uses).toBe('./.github/workflows/test.yml')
    expect(candidate.jobs.record.needs).toBe('verify')
    expect(candidate.jobs.record.if).toBeUndefined()
    const release = workflow('release')
    expect(release.jobs.test.uses).toBe('./.github/workflows/test.yml')
    expect(release.jobs.build.if).toContain("needs.test.result == 'success'")
    expect(checks.on.workflow_call.outputs.artifact_digest.value).toBe(
      '${{ jobs.build.outputs.artifact_digest }}'
    )
  })
})
