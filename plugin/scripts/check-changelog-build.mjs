#!/usr/bin/env node
/** Optional release-build gate, separate from the fast tier. Everything writable lives in
 * disposable full clones; no tag, config, index or commit is changed in the source checkout. */
import { execFileSync, spawnSync } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
  // Do not rely on npm prepare: a host may have ignore-scripts enabled. The regression
  // requires the actual tracked hook to be executable and explicitly enabled in this clone.
  const hooks = join(first, '.githooks')
  accessSync(join(hooks, 'pre-commit'), constants.X_OK)
  gitAt(first, ['config', 'core.hooksPath', hooks])
  if (gitAt(first, ['config', '--get', 'core.hooksPath']) !== hooks)
    throw Error('Release fixture hook is not enabled')
  const version = JSON.parse(readFileSync(join(first, 'manifest.json'), 'utf8'))
    .version.split('.')
    .map(Number)
  const tags = new Set(gitAt(first, ['tag', '-l']).split('\n'))
  do {
    version[2]++
  } while (tags.has(version.join('.')))
  const target = version.join('.')
  // Exercise the real release script only inside this disposable clone, including its hook.
  const release = spawnSync('bash', ['release.sh', target], {
    cwd: first,
    env: {
      ...gitEnvironment(),
      GIT_AUTHOR_DATE: '2025-02-02T00:30:00+02:00',
      GIT_COMMITTER_DATE: '2025-02-02T00:30:00+02:00',
    },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  process.stdout.write(release.stdout ?? '')
  process.stderr.write(release.stderr ?? '')
  if (release.error || release.status !== 0)
    throw release.error ?? Error(`Hook-enabled release failed with status ${release.status}`)
  // Git forwards hook output on stderr, while the shell's own output can be on stdout.
  if (
    !`${release.stdout}${release.stderr}`.includes('pre-commit: running unit and integration tests')
  )
    throw Error('Release fixture skipped its pre-commit hook')
  if (gitAt(first, ['show', '-s', '--format=%s', 'HEAD']) !== `chore: bump version to ${target}`)
    throw Error('Version bump commit did not succeed')
  if (
    gitAt(first, ['rev-parse', `refs/tags/${target}^{commit}`]) !==
    gitAt(first, ['rev-parse', 'HEAD'])
  )
    throw Error('Release tag is not at the bump commit')
  const catalog = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { generateChangelog } from './plugin/scripts/changelog.mjs'; process.stdout.write(JSON.stringify(generateChangelog()))",
      ],
      { cwd: first, env: gitEnvironment(), encoding: 'utf8' }
    )
  )
  if (catalog[0]?.version !== target)
    throw Error('Tagged catalog omitted the newly committed release')
  console.log(`Hook ran; bump commit and tag succeeded; catalog includes ${target}`)
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
