import { expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { generateChangelog, subjectBullet, gitEnvironment } from '../../scripts/changelog.mjs'

it('filters subjects, keeps Unicode and exact text inert', () => {
  expect(subjectBullet('feat(reader)!: add <img src=x>')).toEqual(['features', 'Add <img src=x>'])
  expect(subjectBullet('fix: make māja visible')).toEqual(['fixes', 'Make māja visible'])
  for (const type of ['test', 'chore', 'ci', 'build', 'docs', 'refactor', 'style', 'wip'])
    expect(subjectBullet(`${type}: internal`)).toBeNull()
  expect(subjectBullet('feat: bump version to 1.0.0')).toBeNull()
  expect(subjectBullet('unknown change')).toBeNull()
  expect(
    subjectBullet('refactor: internal', { category: 'features', text: 'Readable feature' })
  ).toEqual(['features', 'Readable feature'])
  expect(subjectBullet('fix: misleading', false)).toBeNull()
  expect(subjectBullet('perf: faster search')).toEqual(['improvements', 'Faster search'])
})

it('anchors tag history, includes pending bump, and reproduces bytes when tagged in a clone', () => {
  const repo = mkdtempSync(join(tmpdir(), 'abele-release-'))
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, `--git-dir=${join(repo, '.git')}`, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...gitEnvironment(),
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        GIT_AUTHOR_DATE: '2025-01-02T12:00:00Z',
        GIT_COMMITTER_DATE: '2025-01-02T12:00:00Z',
      },
    }).trim()
  const commit = (subject: string) => {
    writeFileSync(join(repo, 'subject'), subject)
    git('add', '.')
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', subject)
  }
  try {
    git('init', '-q')
    writeFileSync(join(repo, 'manifest.json'), '{"version":"0.0.1"}')
    writeFileSync(join(repo, 'package.json'), '{"version":"0.0.1"}')
    commit('feat: initial item')
    writeFileSync(join(repo, 'manifest.json'), '{"version":"1.0.0"}')
    writeFileSync(join(repo, 'package.json'), '{"version":"1.0.0"}')
    commit('chore: bump version to 1.0.0')
    git('tag', '1.0.0')
    commit('fix: first fix')
    commit('test: internal')
    writeFileSync(join(repo, 'manifest.json'), '{"version":"1.1.0"}')
    writeFileSync(join(repo, 'package.json'), '{"version":"1.1.0"}')
    commit('chore: bump version to 1.1.0')
    const pending = JSON.stringify(generateChangelog(repo, { historical: [] }))
    git('tag', '1.1.0')
    expect(JSON.stringify(generateChangelog(repo, { historical: [] }))).toBe(pending)
    const clone = mkdtempSync(join(tmpdir(), 'abele-release-clone-'))
    try {
      execFileSync('git', ['-C', repo, 'clone', '-q', repo, clone], {
        cwd: repo,
        env: gitEnvironment(),
      })
      expect(JSON.stringify(generateChangelog(clone, { historical: [] }))).toBe(pending)
      commit('feat: not released')
      git('tag', '2.0.0')
      expect(JSON.stringify(generateChangelog(clone, { historical: [] }))).toBe(pending)
    } finally {
      rmSync(clone, { recursive: true, force: true })
    }
    expect(generateChangelog(repo, { historical: [] }).at(0)?.version).toBe('1.1.0')
    expect(generateChangelog(repo, { historical: [] }).at(0)?.fixes).toEqual(['First fix'])
    git('tag', '-d', '1.0.0')
    expect(() => generateChangelog(repo, { historical: [] })).toThrow(/missing.*tag/i)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}, 120_000) // initialises repositories and clones one; git takes seconds when the machine is busy
