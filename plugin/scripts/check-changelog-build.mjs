#!/usr/bin/env node
/** Optional release-build gate, separate from the fast tier. Everything writable lives in
 * disposable full clones; no tag, config, index or commit is changed in the source checkout. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { gitAt, gitEnvironment } from './changelog-git.mjs'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const scratch = mkdtempSync(join(tmpdir(), 'abele-tag-build-'))
const first = join(scratch, 'first'),
  second = join(scratch, 'second')
const run = (root, command, args, extra = {}) =>
  execFileSync(command, args, {
    cwd: root,
    env: { ...gitEnvironment(), ...extra },
    stdio: 'inherit',
  })
const hash = (root, file) =>
  createHash('sha256')
    .update(readFileSync(join(root, 'plugin/build', file)))
    .digest('hex')
try {
  gitAt(source, ['clone', '-q', '--no-hardlinks', '--no-single-branch', source, first])
  gitAt(first, ['config', 'user.name', 'Fixture'])
  gitAt(first, ['config', 'user.email', 'fixture@example.invalid'])
  run(join(first, 'plugin'), 'npm', ['ci', '--silent'])
  const version = JSON.parse(readFileSync(join(first, 'manifest.json'), 'utf8'))
    .version.split('.')
    .map(Number)
  const tags = new Set(gitAt(first, ['tag', '-l']).split('\n'))
  do {
    version[2]++
  } while (tags.has(version.join('.')))
  const target = version.join('.')
  // Exercise the real release script only inside this disposable clone, including its hook.
  run(first, 'bash', ['release.sh', target], {
    GIT_AUTHOR_DATE: '2025-02-02T00:30:00+02:00',
    GIT_COMMITTER_DATE: '2025-02-02T00:30:00+02:00',
  })
  gitAt(first, ['checkout', '-q', '--detach', target])
  run(join(first, 'plugin'), 'npm', ['run', 'build'], { TZ: 'Pacific/Honolulu' })
  gitAt(first, ['clone', '-q', '--no-hardlinks', '--no-single-branch', first, second])
  gitAt(second, ['checkout', '-q', '--detach', target])
  run(join(second, 'plugin'), 'npm', ['ci', '--silent'])
  run(join(second, 'plugin'), 'npm', ['run', 'build'], { TZ: 'Asia/Tokyo' })
  for (const root of [first, second]) {
    const files = readdirSync(join(root, 'plugin/build')).sort()
    if (JSON.stringify(files) !== JSON.stringify(['main.css', 'main.js']))
      throw Error('Unexpected release build files')
    if (gitAt(root, ['status', '--porcelain']))
      throw Error('Tagged build changed the clean checkout')
  }
  for (const file of ['main.js', 'main.css']) {
    if (hash(first, file) !== hash(second, file)) throw Error(`Tagged clone builds differ: ${file}`)
    console.log(`${file}: identical SHA-256 ${hash(first, file)}`)
  }
  console.log(
    `Release script and clean-clone build reproducibility passed for synthetic tag ${target}`
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
