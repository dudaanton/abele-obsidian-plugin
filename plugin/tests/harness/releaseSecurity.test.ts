import { describe, expect, it } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'

const workflow = (name: string): any =>
  load(readFileSync(`../.github/workflows/${name}.yml`, 'utf8'))

describe('least privilege release and checks', () => {
  it('uses read-only defaults and immutable action references', () => {
    for (const name of ['test', 'release', 'release-candidate']) {
      const file = workflow(name)
      expect(file.permissions).toEqual({ contents: 'read' })
      for (const job of Object.values(file.jobs) as any[]) {
        for (const step of job.steps ?? []) {
          if (step.uses) expect(step.uses).toMatch(/^[^@]+@[a-f0-9]{40}$/)
          if (step.run?.includes('npm ci')) {
            expect(step.run).toContain('npm ci --ignore-scripts')
            expect(job.permissions?.contents ?? file.permissions.contents).toBe('read')
          }
        }
      }
    }
  })

  it('fetches full history and tags in every job that builds the changelog', () => {
    for (const name of ['release', 'test']) {
      const file = workflow(name)
      for (const [id, job] of Object.entries(file.jobs) as [string, any][]) {
        const steps = job.steps ?? []
        if (
          !steps.some((step: any) =>
            /npm run (?:build(?::[\w-]+)?|test:size)\b/.test(step.run ?? '')
          )
        )
          continue
        const checkouts = steps.filter((step: any) => step.uses?.startsWith('actions/checkout@'))
        expect(checkouts.length, `${name}/${id} needs a checkout`).toBeGreaterThan(0)
        for (const checkout of checkouts) {
          expect(checkout.with?.['fetch-depth'], `${name}/${id} must not be shallow`).toBe(0)
          expect(checkout.with?.['fetch-tags'], `${name}/${id} needs changelog tags`).toBe(true)
        }
      }
    }
  })

  it('gates publishing on a tested production build, verifies versions and publishes checksums and provenance', () => {
    const file = workflow('release')
    expect(file.jobs.build.needs).toEqual(['candidate', 'test'])
    expect(file.jobs.test.needs).toBe('candidate')
    expect(file.jobs.test.if).toBe("${{ needs.candidate.outputs.run_id == '' }}")
    expect(file.jobs.build.if).toContain("needs.candidate.result == 'success'")
    expect(file.jobs.build.if).toContain("needs.test.result == 'success'")
    expect(file.jobs.build.if).toContain("needs.test.result == 'skipped'")
    expect(file.jobs.build.if).toContain("needs.candidate.outputs.run_id != ''")
    // The read-only build gate promotes the production artifact from the complete reusable
    // verification workflow; it must never rebuild different bytes after size verification.
    const build = JSON.stringify(file.jobs.build.steps)
    expect(build).toContain('check-release.mjs')
    expect(build).toContain('SHA256SUMS')
    expect(build).toContain('actions/download-artifact')
    expect(build).toContain('EXPECTED_ARTIFACT_DIGEST')
    expect(build).toContain('sha256sum -c -')
    expect(build).toContain('ABELE_PROMOTION_TAG')
    expect(build).not.toContain('npm run build')
    const publish = JSON.stringify(file.jobs.publish)
    expect(file.jobs.publish.needs).toBe('build')
    expect(publish).toContain('sha256sum -c SHA256SUMS')
    expect(publish).toContain('actions/attest-build-provenance')
    expect(publish).toContain('release/SHA256SUMS')
    expect(publish).not.toContain('npm ')
  })

  it('executes archive digest and extracted-byte verification with a fake API', () => {
    const root = mkdtempSync(join(tmpdir(), 'sample-release-archive-'))
    try {
      const assets = join(root, 'assets')
      const build = join(root, 'plugin/build')
      const tools = join(root, 'tools')
      for (const dir of [assets, build, tools]) mkdirSync(dir, { recursive: true })
      writeFileSync(join(assets, 'main.js'), 'sample production')
      writeFileSync(join(build, 'main.js'), 'sample production')
      const archive = join(root, 'archive.zip')
      execFileSync('zip', ['-q', archive, 'main.js'], { cwd: assets })
      const digest = createHash('sha256').update(readFileSync(archive)).digest('hex')
      writeFileSync(
        join(tools, 'gh'),
        `#!/usr/bin/env node
        const fs = require('node:fs');
        if (process.argv[3].endsWith('/zip')) process.stdout.write(fs.readFileSync(process.env.SAMPLE_ARCHIVE));
        else console.log('42');
      `
      )
      chmodSync(join(tools, 'gh'), 0o755)
      const step = workflow('release').jobs.build.steps.find(
        (s: any) => s.name === 'Verify immutable production archive digest'
      )
      const verify = (expected = digest) => {
        const runner = join(root, 'runner')
        rmSync(runner, { recursive: true, force: true })
        mkdirSync(runner)
        return execFileSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
          cwd: root,
          stdio: 'pipe',
          env: {
            ...process.env,
            PATH: `${tools}:${process.env.PATH}`,
            REPO: 'sample/example',
            RUN_ID: '7',
            RUNNER_TEMP: runner,
            EXPECTED_ARTIFACT_DIGEST: expected,
            SAMPLE_ARCHIVE: archive,
          },
        })
      }
      expect(() => verify()).not.toThrow()
      expect(() => verify('b'.repeat(64))).toThrow()
      writeFileSync(join(build, 'main.js'), 'different downloaded bytes')
      expect(() => verify()).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('builds and measures once, overlapping build/size with tests and lint after types', () => {
    const file = workflow('test')
    expect(file.jobs.build.needs).toBe('types')
    expect(file.jobs.test.needs).toBeUndefined()
    const types = JSON.stringify(file.jobs.types.steps)
    expect(types).toContain('npm run types')
    expect(types).toContain('types.json')
    const build = JSON.stringify(file.jobs.build.steps)
    expect(build).toContain('npm run build:verified')
    expect(build).toContain('ABELE_BUILD_ARTIFACT')
    expect(build).toContain('npm run test:size')
    expect(JSON.stringify(file.jobs.test.steps)).not.toContain('npm run types')
    expect(JSON.stringify(file.jobs.test.steps)).not.toContain('npm run test:size')
  })

  it('verifies an exact candidate revision through all gates without publishing', () => {
    const candidate = workflow('release-candidate')
    expect(candidate.on.workflow_dispatch.inputs.revision.required).toBe(true)
    expect(candidate.jobs.verify.uses).toBe('./.github/workflows/test.yml')
    expect(candidate.jobs.verify.with.revision).toBe('${{ inputs.revision }}')
    expect(candidate.jobs.verify.with.test_scope).toBe('all')
    expect(candidate.jobs.record.needs).toBe('verify')
    expect(JSON.stringify(candidate.jobs.record)).toContain('artifact_digest')
    const packageStep = candidate.jobs.record.steps.find(
      (s: any) => s.name === 'Export verified candidate assets'
    )
    expect(packageStep.run).toContain('export-release-artifact.mjs')
    const artifact = candidate.jobs.record.steps.find(
      (s: any) => s.with?.name === 'release-candidate-${{ inputs.revision }}'
    )
    expect(artifact).toBeDefined()
    // Release metadata remains available as CI evidence/attestation, not extra release assets.
    const publish = workflow('release').jobs.publish.steps.find(
      (s: any) => s.name === 'Publish release with checksums'
    ).run
    for (const name of ['main.js', 'styles.css', 'manifest.json', 'SHA256SUMS'])
      expect(publish).toContain(`release/${name}`)
    for (const extra of ['build-report.json', 'build-manifest.json', 'provenance.json'])
      expect(publish).not.toContain(`release/${extra}`)
    expect(JSON.stringify(candidate)).not.toMatch(/contents":"write|gh release|publish/)
    const file = workflow('test')
    expect(file.on.workflow_call.outputs.artifact_digest).toBeDefined()
    for (const job of Object.values(file.jobs) as any[]) {
      const checkout = job.steps?.find((s: any) => s.uses?.startsWith('actions/checkout'))
      if (checkout) {
        expect(checkout.with.ref).toBe('${{ inputs.revision || github.sha }}')
        expect(checkout.with['persist-credentials']).toBe(false)
      }
    }
  })

  it('keeps the raw version tag convention used by release.sh', () => {
    const script = readFileSync('../release.sh', 'utf8')
    expect(script).toContain('git tag "$version"')
    expect(readFileSync('.npmrc', 'utf8')).toContain('tag-version-prefix=""')
  })
})
