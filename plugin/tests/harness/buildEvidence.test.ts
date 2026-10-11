// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  chmodSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { inputIdentity, recordTypes, requireTypes } from '../../scripts/build-inputs.mjs'
import { writeArtifact, verifyArtifact } from '../../scripts/build-artifact.mjs'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sample-build-'))
  roots.push(root)
  mkdirSync(join(root, 'plugin/src'), { recursive: true })
  mkdirSync(join(root, 'plugin/node_modules'), { recursive: true })
  writeFileSync(join(root, 'plugin/src/main.ts'), 'export const sample = 1')
  writeFileSync(join(root, 'manifest.json'), '{"version":"1.0.0"}')
  writeFileSync(join(root, 'plugin/package.json'), '{"version":"1.0.0"}')
  writeFileSync(join(root, 'plugin/node_modules/.package-lock.json'), '{}')
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, 'add', 'manifest.json', 'plugin/src', 'plugin/package.json'])
  execFileSync('git', [
    '-C',
    root,
    '-c',
    'user.name=Sample',
    '-c',
    'user.email=sample@example.invalid',
    'commit',
    '-qm',
    'test: sample',
  ])
  return root
}

describe('matching type evidence', () => {
  it('fails closed without a successful receipt and detects changed inputs and dependencies', () => {
    const root = fixture()
    expect(() => requireTypes(root)).toThrow()
    const before = inputIdentity(root)
    recordTypes(root, before)
    expect(() => requireTypes(root)).not.toThrow()
    writeFileSync(join(root, 'plugin/src/main.ts'), 'export const sample = 2')
    expect(() => requireTypes(root)).toThrow(/matching/)
    expect(() => recordTypes(root, before)).toThrow(/changed/)
    recordTypes(root, inputIdentity(root))
    writeFileSync(join(root, 'plugin/node_modules/.package-lock.json'), '{"changed":true}')
    expect(() => requireTypes(root)).toThrow(/matching/)
  })
  it('records only both successful passes and removes old evidence on failure', () => {
    const root = fixture()
    const scripts = join(root, 'plugin/scripts')
    mkdirSync(scripts)
    for (const name of ['checked-build.mjs', 'build-inputs.mjs', 'changelog-git.mjs'])
      writeFileSync(
        join(scripts, name),
        readFileSync(new URL(`../../scripts/${name}`, import.meta.url))
      )
    const compiler = join(root, 'plugin/node_modules/typescript/bin')
    mkdirSync(compiler, { recursive: true })
    writeFileSync(
      join(compiler, 'tsc'),
      'if (process.env.SAMPLE_FAIL === "normal") process.exit(1)'
    )
    writeFileSync(
      join(scripts, 'check-strict-null.mjs'),
      'if (process.env.SAMPLE_FAIL === "strict") process.exit(1)'
    )
    const run = (fail = '') =>
      execFileSync(process.execPath, [join(scripts, 'checked-build.mjs'), 'types'], {
        env: { ...process.env, SAMPLE_FAIL: fail },
        stdio: 'pipe',
      })
    run()
    expect(() => requireTypes(root)).not.toThrow()
    for (const fail of ['normal', 'strict']) {
      expect(() => run(fail)).toThrow()
      expect(() => requireTypes(root)).toThrow()
      run()
    }
  })
  it('invalidates source links when their resolved bytes change', () => {
    const root = fixture()
    const target = join(root, 'plugin/node_modules/sample-types.d.ts')
    writeFileSync(target, 'export const sample: 1')
    symlinkSync('../node_modules/sample-types.d.ts', join(root, 'plugin/src/sample.ts'))
    recordTypes(root, inputIdentity(root))
    writeFileSync(target, 'export const sample: 2')
    expect(() => requireTypes(root)).toThrow(/matching/)
  })
  it('includes new source files and deletions, not just committed tree hashes', () => {
    const root = fixture()
    recordTypes(root, inputIdentity(root))
    writeFileSync(join(root, 'plugin/src/new.ts'), 'export {}')
    expect(() => requireTypes(root)).toThrow()
    rmSync(join(root, 'plugin/src/new.ts'))
    rmSync(join(root, 'plugin/src/main.ts'))
    expect(() => requireTypes(root)).toThrow()
  })
})

describe('exact emitted artifact evidence', () => {
  function artifact(root: string, mode = 'production') {
    const dir = join(root, 'plugin/build')
    mkdirSync(dir)
    writeFileSync(join(dir, 'main.js'), 'const sample = 1;')
    writeFileSync(join(dir, 'main.css'), '.sample {}')
    const report = {
      mainJsBytes: 17,
      stylesBytes: 10,
      files: ['main.js', 'main.css'],
      byPackage: [],
      runtimeElements: { script: 0, style: 0 },
    }
    writeArtifact(root, dir, mode, report)
    return dir
  }
  it('verifies checksums, mode, source revision and report against the emitted bytes', () => {
    const root = fixture()
    const dir = artifact(root)
    expect(verifyArtifact(root, dir, 'production').mainJsBytes).toBe(17)
    expect(() => verifyArtifact(root, dir, 'sharing-test')).toThrow(/mode/)
    writeFileSync(join(dir, 'main.js'), 'changed')
    expect(() => verifyArtifact(root, dir, 'production')).toThrow(/checksum/)
  })
  it.each(['production', 'sharing-test'])(
    'installs verified %s bytes without dependencies or rebuilding',
    (mode) => {
      const root = fixture()
      const plugin = join(root, 'plugin')
      const scripts = join(plugin, 'scripts')
      mkdirSync(scripts)
      for (const name of [
        'build-artifact.mjs',
        'build-inputs.mjs',
        'build-report.mjs',
        'check-release.mjs',
        'release-checks.mjs',
        'changelog-git.mjs',
        'production-test-guard.mjs',
      ])
        writeFileSync(
          join(scripts, name),
          readFileSync(new URL(`../../scripts/${name}`, import.meta.url))
        )
      const suffix = mode === 'production' ? 'prod' : 'test'
      const script = `build_and_copy_plugin_${suffix}.sh`
      writeFileSync(join(plugin, script), readFileSync(new URL(`../../${script}`, import.meta.url)))
      const target = join(root, 'output')
      mkdirSync(target)
      writeFileSync(join(root, '.gitignore'), 'output/\n')
      writeFileSync(join(plugin, '.gitignore'), 'node_modules/\nbuild/\n*.env\n')
      writeFileSync(join(plugin, `.${suffix}.env`), `TARGET_VAULT_DIR="${target}"\n`)
      const tools = join(root, 'tools')
      mkdirSync(tools)
      writeFileSync(join(tools, 'npm'), '#!/bin/sh\nexit 99\n')
      chmodSync(join(tools, 'npm'), 0o755)
      const dir = artifact(root, mode)
      rmSync(join(plugin, 'node_modules'), { recursive: true })
      const install = () =>
        execFileSync('bash', [script, '--artifact', dir], {
          cwd: plugin,
          env: { ...process.env, PATH: `${tools}:${process.env.PATH}` },
          stdio: 'pipe',
        })
      install()
      expect(readFileSync(join(target, 'main.js'), 'utf8')).toBe('const sample = 1;')
      expect(readFileSync(join(target, 'styles.css'), 'utf8')).toBe('.sample {}')
      expect(readFileSync(join(target, 'manifest.json'), 'utf8')).toBe('{"version":"1.0.0"}')
      writeFileSync(join(dir, 'main.js'), 'broken')
      expect(install).toThrow()
      expect(readFileSync(join(target, 'main.js'), 'utf8')).toBe('const sample = 1;')
    }
  )
  it('rejects changed source, tags and extra chunks rather than silently rebuilding', () => {
    const root = fixture()
    const dir = artifact(root)
    writeFileSync(join(dir, 'chunk.js'), 'extra')
    expect(() => verifyArtifact(root, dir, 'production')).toThrow(/output/)
    rmSync(join(dir, 'chunk.js'))
    execFileSync('git', ['-C', root, 'tag', '1.0.0'])
    expect(() => verifyArtifact(root, dir, 'production')).toThrow(/provenance/)
  })
  it('runs the release CLI to completion, including artifact checks', () => {
    const root = fixture()
    const scripts = join(root, 'plugin/scripts')
    mkdirSync(scripts)
    for (const name of [
      'build-artifact.mjs',
      'build-inputs.mjs',
      'build-report.mjs',
      'check-release.mjs',
      'release-checks.mjs',
      'changelog-git.mjs',
      'production-test-guard.mjs',
    ])
      writeFileSync(
        join(scripts, name),
        readFileSync(new URL(`../../scripts/${name}`, import.meta.url))
      )
    const dir = artifact(root)
    const run = (tag = '1.0.0') =>
      execFileSync(process.execPath, [join(scripts, 'check-release.mjs')], {
        cwd: join(root, 'plugin'),
        env: { ...process.env, TAG: tag },
        encoding: 'utf8',
        stdio: 'pipe',
      })
    expect(run()).toContain('Verified production release 1.0.0')
    expect(() => run('1.0.1')).toThrow()
    writeFileSync(join(dir, 'main.js'), 'corrupt')
    expect(() => run()).toThrow()
  })
  it('promotes only a newly attached matching lightweight tag on the exact pending bump', () => {
    const root = fixture()
    execFileSync('git', [
      '-C',
      root,
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.invalid',
      'commit',
      '--allow-empty',
      '-qm',
      'chore: bump version to 1.0.0',
    ])
    const dir = artifact(root)
    execFileSync('git', ['-C', root, 'tag', '1.0.0'])
    expect(() => verifyArtifact(root, dir, 'production')).toThrow(/provenance/)
    expect(() => verifyArtifact(root, dir, 'production', { promotionTag: '1.0.0' })).not.toThrow()
    expect(() => verifyArtifact(root, dir, 'production', { promotionTag: '2.0.0' })).toThrow()
    execFileSync('git', ['-C', root, 'tag', '0.9.0'])
    expect(() => verifyArtifact(root, dir, 'production', { promotionTag: '1.0.0' })).toThrow(
      /provenance/
    )
  })
  it('checks marker exclusion and report measurements even with recomputed checksums', () => {
    const root = fixture()
    const dir = artifact(root)
    const report = JSON.parse(readFileSync(join(dir, 'build-report.json'), 'utf8'))
    writeFileSync(join(dir, 'main.js'), '__abeleTest')
    writeArtifact(root, dir, 'production', report)
    expect(() => verifyArtifact(root, dir, 'production')).toThrow(/marker/)
    writeFileSync(join(dir, 'main.js'), 'const sample = 2; more')
    writeArtifact(root, dir, 'production', report)
    expect(() => verifyArtifact(root, dir, 'production')).toThrow(/report/)
  })
})
