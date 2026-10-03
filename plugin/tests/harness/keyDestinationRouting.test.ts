import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { load } from 'js-yaml'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const workflow = load(read('../../../.github/workflows/test.yml')) as any
const release = load(read('../../../.github/workflows/release.yml')) as any
const pkg = JSON.parse(read('../../package.json'))
const step = workflow.jobs.test.steps.find((s: any) => s.name === 'Unit and integration tests')

// Run the actual workflow selector with a shell-function fixture, never npm or the suite.
function select(scope?: string) {
  const env = { ...process.env }
  if (scope === undefined) delete env.TEST_SCOPE
  else env.TEST_SCOPE = scope
  return execFileSync('bash', ['-c', `set -e\nnpm() { printf '%s\\n' "$*"; }\n${step.run}`], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

describe('bounded one-release key-destination routing', () => {
  it('defaults reusable callers and ordinary pushes/PRs to the full test suite', () => {
    expect(workflow.on.workflow_call.inputs.test_scope).toEqual({
      type: 'string',
      required: false,
      default: 'all',
    })
    expect(workflow.on.push.branches).toEqual(['master'])
    expect(workflow.on).toHaveProperty('pull_request')
    expect(step.env.TEST_SCOPE).toBe("${{ inputs.test_scope || 'all' }}")
    expect(select()).toBe('test')
    expect(select('all')).toBe('test')
  })
  it('allows only the exact focused scope and fails closed on unexpected input', () => {
    expect(select('key-destinations')).toBe('run test:key-destinations')
    for (const invalid of ['other', 'key-destinations; echo unsafe', 'KEY-DESTINATIONS']) {
      expect(() => select(invalid)).toThrow()
    }
  })
  it('pins the sole release exception to the exact tag and leaves publish gates in place', () => {
    expect(release.jobs.test.with.test_scope).toBe(
      "${{ github.ref_name == '1.69.0' && 'key-destinations' || 'all' }}"
    )
    expect(release.jobs.build.needs).toBe('test')
    expect(release.jobs.publish.needs).toBe('build')
    expect(
      release.jobs.build.steps.find((s: any) => s.name === 'Build and verify production assets').run
    ).toContain('node scripts/check-release.mjs')
    expect(
      release.jobs.publish.steps.find((s: any) => s.name === 'Verify the downloaded assets').run
    ).toContain('sha256sum -c SHA256SUMS')
    expect(workflow.jobs.test.steps.find((s: any) => s.name === 'Bundle size').run).toBe(
      'npm run test:size'
    )
  })
  it('uses an explicit existing-file list rather than broad dependency-related selection', () => {
    const command: string = pkg.scripts['test:key-destinations']
    expect(command).toMatch(/^vitest run tests\//)
    expect(command).not.toMatch(/related|passWithNoTests|\.\.\.|\*/)
    const files = command.replace(/^vitest run /, '').split(' ')
    expect(files).toContain('tests/integration/manualKeyConsent.test.ts')
    expect(files).toContain('tests/component/manualKeyConsentDialog.test.ts')
    expect(files).toContain('tests/harness/keyDestinationRouting.test.ts')
    for (const file of files) expect(read(`../../${file}`)).not.toBe('')
    expect(pkg.scripts.test).toBe('vitest run')
  })
})
