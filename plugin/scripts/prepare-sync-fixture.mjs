#!/usr/bin/env node
/** Export committed source; never build in or pack the caller's live sync checkout. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [repo, revision] = process.argv.slice(2)
if (!repo || !revision)
  throw new Error('Usage: prepare-sync-fixture.mjs <repository> <exact revision>')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })
const git = (...args) =>
  execFileSync('git', ['-C', resolve(repo), ...args], { encoding: 'utf8' }).trim()
const commit = git('rev-parse', `${revision}^{commit}`)
const scratch = join(plugin, '..', '.scratch', 'sync-inputs')
mkdirSync(scratch, { recursive: true })
const work = mkdtempSync(join(scratch, 'fixture-'))
const archive = join(work, 'source.tar')
run('git', ['-C', resolve(repo), 'archive', '--format=tar', '-o', archive, commit])
const source = join(work, 'source')
mkdirSync(source)
run('tar', ['-xf', archive, '-C', source])
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const lockHash = hash(readFileSync(join(source, 'package-lock.json')))
run('npm', ['ci', '--ignore-scripts=false'], source)
const config = join(source, 'tsconfig.base.json')
const options = JSON.parse(readFileSync(config))
options.compilerOptions.sourceMap = false
writeFileSync(config, JSON.stringify(options, null, 2) + '\n')
run(
  join(source, 'node_modules/.bin/tsc'),
  ['-b', '--force', 'packages/protocol', 'packages/server', 'packages/core', 'packages/cli'],
  source
)
const filesOf = (root, prefix = '') =>
  Object.fromEntries(
    readdirSync(join(root, prefix))
      .sort()
      .flatMap((name) => {
        const path = join(prefix, name)
        return statSync(join(root, path)).isDirectory()
          ? Object.entries(filesOf(root, path))
          : [[path, hash(readFileSync(join(root, path)))]]
      })
  )
const provenance = {
  commit,
  lockSha256: lockHash,
  node: process.version,
  npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
  typescript: JSON.parse(readFileSync(join(source, 'node_modules/typescript/package.json')))
    .version,
  sourceMap: options.compilerOptions.sourceMap ?? false,
}
const files = {}
for (const name of ['core', 'protocol', 'server', 'cli']) {
  for (const part of ['src', 'dist', 'tests']) {
    const root = join(source, 'packages', name, part)
    for (const [path, checksum] of Object.entries(filesOf(root)))
      files[`packages/${name}/${part}/${path}`] = checksum
  }
}
writeFileSync(
  join(source, '.abele-sync-fixture.json'),
  JSON.stringify({ ...provenance, files }, null, 2) + '\n'
)
console.log(`ABELE_SYNC_DIR=${source}`)
