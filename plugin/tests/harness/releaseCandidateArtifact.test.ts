// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeArtifact } from '../../scripts/build-artifact.mjs'
import { exportReleaseArtifact } from '../../scripts/export-release-artifact.mjs'
import { sha256 } from '../../scripts/build-inputs.mjs'
import { readProductionReport } from '../../scripts/bundle-size.mjs'
import { catalogAssetNames } from '../../scripts/release-checks.mjs'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sample-candidate-assets-'))
  roots.push(root)
  mkdirSync(join(root, 'plugin/node_modules'), { recursive: true })
  mkdirSync(join(root, 'plugin/build'))
  writeFileSync(join(root, '.gitignore'), 'plugin/node_modules/\nplugin/build/\n')
  writeFileSync(join(root, 'manifest.json'), '{"version":"1.0.0"}')
  writeFileSync(join(root, 'plugin/package.json'), '{"version":"1.0.0"}')
  writeFileSync(join(root, 'plugin/node_modules/.package-lock.json'), '{}')
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  git('add', '.')
  git(
    '-c',
    'user.name=Sample',
    '-c',
    'user.email=sample@example.invalid',
    'commit',
    '-qm',
    'chore: bump version to 1.0.0'
  )
  const build = join(root, 'plugin/build')
  writeFileSync(join(build, 'main.js'), 'const sample = 1;')
  writeFileSync(join(build, 'main.css'), '.sample {}')
  for (const name of catalogAssetNames) writeFileSync(join(build, name), '{}')
  writeArtifact(root, build, 'production', {
    mainJsBytes: 17,
    stylesBytes: 10,
    files: ['main.js', 'main.css', ...catalogAssetNames],
    runtimeElements: { script: 0, style: 0 },
    byPackage: [],
  })
  return { root, build, git }
}
it('exports the candidate schema with checksums of plugin and translation assets', () => {
  const { root, build, git } = fixture()
  const target = join(build, '../node_modules/.cache/candidate')
  exportReleaseArtifact(root, build, target)
  expect(readdirSync(target).sort()).toEqual(
    [
      'SHA256SUMS',
      'main.js',
      'manifest.json',
      'provenance.json',
      'styles.css',
      ...catalogAssetNames,
    ].sort()
  )
  const files = Object.fromEntries(
    ['main.js', 'styles.css', 'manifest.json', ...catalogAssetNames].map((name) => [
      name,
      sha256(readFileSync(join(target, name))),
    ])
  )
  expect(JSON.parse(readFileSync(join(target, 'provenance.json'), 'utf8'))).toEqual({
    revision: git('rev-parse', 'HEAD'),
    files,
  })
  expect(readFileSync(join(target, 'SHA256SUMS'), 'utf8')).toBe(
    Object.entries(files)
      .map(([name, hash]) => `${hash}  ${name}\n`)
      .join('')
  )
  expect(readFileSync(join(target, 'main.js'))).toEqual(readFileSync(join(build, 'main.js')))
  expect(readFileSync(join(target, 'styles.css'))).toEqual(readFileSync(join(build, 'main.css')))
})
it('keeps all candidate bytes and checksums identical after the matching version tag is attached', () => {
  const { root, build, git } = fixture()
  const first = join(root, 'plugin/node_modules/.cache/before')
  const tagged = join(root, 'plugin/node_modules/.cache/after')
  exportReleaseArtifact(root, build, first)
  git('tag', '1.0.0')
  expect(() => exportReleaseArtifact(root, build, tagged)).toThrow(/provenance/)
  exportReleaseArtifact(root, build, tagged, { promotionTag: '1.0.0' })
  for (const name of readdirSync(first))
    expect(readFileSync(join(tagged, name))).toEqual(readFileSync(join(first, name)))
})
it('lets size checks implicitly reuse the just-built production report without rebuilding', async () => {
  const { root, build } = fixture()
  const rebuild = vi.fn(() => {
    throw new Error('Must not rebuild')
  })
  expect((await readProductionReport(join(root, 'plugin'), undefined, rebuild)).mainJsBytes).toBe(
    17
  )
  expect(rebuild).not.toHaveBeenCalled()
  writeFileSync(join(build, 'main.js'), 'corrupt')
  await expect(readProductionReport(join(root, 'plugin'), undefined, rebuild)).rejects.toThrow(
    /checksum/
  )
  expect(rebuild).not.toHaveBeenCalled()
})
it('preserves the standalone size-build fallback when no artifact manifest exists', async () => {
  const { root, build } = fixture()
  const report = JSON.parse(readFileSync(join(build, 'build-report.json'), 'utf8'))
  rmSync(join(build, 'build-manifest.json'))
  const rebuild = vi.fn(async () => {
    writeArtifact(root, build, 'production', report)
  })
  expect((await readProductionReport(join(root, 'plugin'), undefined, rebuild)).mainJsBytes).toBe(
    17
  )
  expect(rebuild).toHaveBeenCalledOnce()
})
it('offers the harness guarded build name without removing standalone type checks', () => {
  const { scripts } = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  )
  expect(scripts['build:verified']).toBe('node scripts/checked-build.mjs build production')
  expect(scripts.build).toContain('npm run types')
})

it('rejects damaged production bytes instead of creating a publishable package', () => {
  const { root, build } = fixture()
  writeFileSync(join(build, 'main.js'), 'corrupt')
  expect(() =>
    exportReleaseArtifact(root, build, join(root, 'plugin/node_modules/.cache/bad'))
  ).toThrow(/checksum/)
})

it('rejects a damaged translation asset before export', () => {
  const { root, build } = fixture()
  writeFileSync(join(build, 'abele-i18n-ru.json'), 'corrupt')
  expect(() =>
    exportReleaseArtifact(root, build, join(root, 'plugin/node_modules/.cache/bad'))
  ).toThrow(/checksum/)
})
