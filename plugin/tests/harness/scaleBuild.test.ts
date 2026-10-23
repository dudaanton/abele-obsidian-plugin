// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  installSdkTarball,
  verifyPreparedSdk,
  recordBuildReceipt,
  validateBuildReceipt,
  buildCandidate,
} from '../scale/build.mjs'

const execute = promisify(execFile)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function fixture() {
  const scratch = join(process.cwd(), '.scratch')
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, 'scale-build-'))
  const plugin = join(root, 'plugin'),
    source = join(root, 'input/package')
  await mkdir(plugin, { recursive: true })
  await mkdir(source, { recursive: true })
  await writeFile(
    join(plugin, 'package.json'),
    JSON.stringify({ name: 'sample-plugin', version: '1.0.0', private: true })
  )
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({
      name: '@abele/sync-sdk',
      version: '0.0.1',
      scripts: { postinstall: 'node -e "process.exit(73)"' },
    })
  )
  await writeFile(join(source, 'index.js'), 'export const sample = 1\n')
  const path = join(root, 'sample-sdk.tgz')
  await execute('tar', ['-czf', path, '-C', join(root, 'input'), 'package'])
  return { root, plugin, path, sha256: sha(await readFile(path)) }
}

describe('scale development SDK input', () => {
  it('does not mistake npm-generated nested dependency bin links for archive payload', async () => {
    const f = await fixture()
    try {
      const sdk = await installSdkTarball(
        f.plugin,
        { path: f.path, sha256: f.sha256 },
        async (...args) => {
          const result = await execute(...args)
          const nested = join(f.plugin, 'node_modules/@abele/sync-sdk/node_modules')
          await mkdir(join(nested, '.bin'), { recursive: true })
          await writeFile(join(nested, 'sample-bin.js'), 'sample dependency')
          await symlink('../sample-bin.js', join(nested, '.bin/sample'))
          return result
        },
        { offline: true, cache: join(f.root, 'cache') }
      )
      expect(sdk.payload['node_modules/.bin/sample']).toBe(
        `link:../sample-bin.js:${sha(Buffer.from('sample dependency'))}`
      )
      await verifyPreparedSdk(f.plugin, sdk)
      await writeFile(
        join(f.plugin, 'node_modules/@abele/sync-sdk/node_modules/sample-bin.js'),
        'changed dependency'
      )
      await expect(verifyPreparedSdk(f.plugin, sdk)).rejects.toThrow('payload')
    } finally {
      await rm(f.root, { recursive: true, force: true })
    }
  })
  it('rejects a wrong checksum before invoking npm or modifying the export', async () => {
    const f = await fixture()
    const calls = []
    const before = await readFile(join(f.plugin, 'package.json'), 'utf8')
    try {
      await expect(
        installSdkTarball(f.plugin, { path: f.path, sha256: '0'.repeat(64) }, async (...args) => {
          calls.push(args)
        })
      ).rejects.toThrow('checksum')
      expect(calls).toEqual([])
      expect(await readFile(join(f.plugin, 'package.json'), 'utf8')).toBe(before)
    } finally {
      await rm(f.root, { recursive: true, force: true })
    }
  })
  it('refuses a nested executable link escaping the installed SDK', async () => {
    const f = await fixture()
    try {
      await expect(
        installSdkTarball(
          f.plugin,
          { path: f.path, sha256: f.sha256 },
          async (...args) => {
            const result = await execute(...args)
            const bin = join(f.plugin, 'node_modules/@abele/sync-sdk/node_modules/.bin')
            await mkdir(bin, { recursive: true })
            await symlink(join(f.root, 'input/package/index.js'), join(bin, 'sample'))
            return result
          },
          { offline: true, cache: join(f.root, 'cache') }
        )
      ).rejects.toThrow('Linked SDK payload refused')
    } finally {
      await rm(f.root, { recursive: true, force: true })
    }
  })
  it('installs a local archive fully offline without running its scripts and records honest source provenance', async () => {
    const f = await fixture()
    try {
      const sdk = await installSdkTarball(f.plugin, { path: f.path, sha256: f.sha256 }, execute, {
        offline: true,
        cache: join(f.root, 'cache'),
      })
      expect(sdk).toMatchObject({
        kind: 'tarball',
        path: f.path,
        sha256: f.sha256,
        version: '0.0.1',
      })
      expect(sdk.resolved).toMatch(/^file:/)
      expect(sdk.integrity).toMatch(/^sha512-/)
      await verifyPreparedSdk(f.plugin, sdk)
      const artifact = {
        provenance: { git: { revision: 'a'.repeat(40) } },
        files: { 'main.js': 'sample-digest' },
      }
      const receipt = await recordBuildReceipt(
        { pluginRoot: f.plugin, build: 'a'.repeat(40), output: f.root },
        sdk,
        artifact
      )
      expect(receipt.sdk.payload['index.js']).toBe(sha(Buffer.from('export const sample = 1\n')))
      expect(
        JSON.parse(await readFile(join(f.root, 'build-receipt.json'), 'utf8')).sdk.sha256
      ).toBe(f.sha256)
      expect(() =>
        validateBuildReceipt(receipt, artifact, 'a'.repeat(40), { sha256: f.sha256 })
      ).not.toThrow()
      expect(() =>
        validateBuildReceipt(
          receipt,
          { ...artifact, files: { 'main.js': 'different' } },
          'a'.repeat(40)
        )
      ).toThrow('manifest')
      expect(() =>
        validateBuildReceipt(receipt, artifact, 'a'.repeat(40), { sha256: 'f'.repeat(64) })
      ).toThrow('SDK')
      await writeFile(join(f.plugin, 'node_modules/@abele/sync-sdk/index.js'), 'changed')
      await expect(verifyPreparedSdk(f.plugin, sdk)).rejects.toThrow('payload')
      await expect(
        recordBuildReceipt(
          { pluginRoot: f.plugin, build: 'a'.repeat(40), output: f.root },
          sdk,
          artifact
        )
      ).rejects.toThrow('payload')
    } finally {
      await rm(f.root, { recursive: true, force: true })
    }
  })
  it('refuses a build receipt for a different plugin revision', async () => {
    const f = await fixture()
    try {
      await expect(
        recordBuildReceipt({ pluginRoot: f.plugin, build: 'a'.repeat(40), output: f.root }, null, {
          provenance: { git: { revision: 'b'.repeat(40) } },
        })
      ).rejects.toThrow('revision')
    } finally {
      await rm(f.root, { recursive: true, force: true })
    }
  })
  it('refuses an attached checkout before any dependency install', async () => {
    const f = await fixture(),
      calls = []
    try {
      await expect(
        buildCandidate({ pluginRoot: f.plugin, build: 'a'.repeat(40) }, async (command, args) => {
          calls.push(command)
          return {
            stdout: args.includes('rev-parse')
              ? 'a'.repeat(40)
              : args.includes('status')
                ? ''
                : 'refs/heads/sample',
          }
        })
      ).rejects.toThrow('detached')
      expect(calls).not.toContain('npm')
    } finally {
      await rm(f.root, { recursive: true, force: true })
    }
  })
})
