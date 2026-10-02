import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'

const workflow = (name: string): any =>
  load(readFileSync(`../.github/workflows/${name}.yml`, 'utf8'))

describe('least privilege release and checks', () => {
  it('uses read-only defaults and immutable action references', () => {
    for (const name of ['test', 'release']) {
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

  it('gates publishing on a tested production build, verifies versions and publishes checksums and provenance', () => {
    const file = workflow('release')
    expect(file.jobs.build.needs).toBe('test')
    const build = JSON.stringify(file.jobs.build.steps)
    expect(build).toContain('check-release.mjs')
    expect(build).toContain('SHA256SUMS')
    const publish = JSON.stringify(file.jobs.publish)
    expect(file.jobs.publish.needs).toBe('build')
    expect(publish).toContain('sha256sum -c SHA256SUMS')
    expect(publish).toContain('actions/attest-build-provenance')
    expect(publish).toContain('release/SHA256SUMS')
    expect(publish).not.toContain('npm ')
  })

  it('keeps the raw version tag convention used by release.sh', () => {
    const script = readFileSync('../release.sh', 'utf8')
    expect(script).toContain('git tag "$version"')
    expect(readFileSync('.npmrc', 'utf8')).toContain('tag-version-prefix=""')
  })
})
