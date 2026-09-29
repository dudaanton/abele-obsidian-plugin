import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitEnvironment } from '../../scripts/changelog-git.mjs'

/** Every command is tied to this disposable repository, regardless of hook environment. */
export function changelogFixture() {
  const root = mkdtempSync(join(tmpdir(), 'abele-history-'))
  let counter = 0
  const env = () => ({
    ...gitEnvironment(),
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2025-01-02T00:30:00+02:00',
    GIT_COMMITTER_DATE: '2025-01-02T00:30:00+02:00',
  })
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-C', root, `--git-dir=${join(root, '.git')}`, `--work-tree=${root}`, ...args],
      { cwd: root, env: env(), encoding: 'utf8' }
    ).trim()
  const commit = (subject: string) => {
    writeFileSync(join(root, 'sample.txt'), `Synthetic item ${++counter}`)
    git('add', '.')
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', subject)
    return git('rev-parse', 'HEAD')
  }
  const bump = (version: string, tag = true) => {
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version }))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
    const revision = commit(`chore: bump version to ${version}`)
    if (tag) git('tag', version)
    return revision
  }
  git('init', '-q', '-b', 'main')
  return {
    root,
    git,
    commit,
    bump,
    env,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}
