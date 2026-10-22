// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateChangelog } from '../../scripts/changelog.mjs'
import * as historyGit from '../../scripts/changelog-git.mjs'
import { changelogFixture } from '../helpers/changelogFixture'

const releaseBoundaries = 12

it(
  'bounds Git queries independently of the number of release boundaries',
  () => {
    const f = changelogFixture()
    try {
      for (let i = 0; i < releaseBoundaries; i++) {
        f.commit(`feat: sample item ${i}`)
        f.bump(`1.${i}.0`)
      }
      const git = vi.spyOn(historyGit, 'gitAt')
      try {
        const releases = generateChangelog(f.root, { historical: [] })
        expect(releases).toHaveLength(releaseBoundaries)
        for (let i = 0; i < releaseBoundaries; i++) {
          const release = releases.find((r) => r.version === `1.${i}.0`)
          expect(release?.features).toEqual([`Sample item ${i}`])
          expect(release?.date).toBe('2025-01-01')
        }
        expect(git.mock.calls.length).toBeLessThanOrEqual(12)
      } finally {
        git.mockRestore()
      }
    } finally {
      f.dispose()
    }
    // Fixture construction launches several Git processes per boundary; query count is the guard.
  },
  10_000 + releaseBoundaries * 10_000
)

it('assigns merged side-branch history exactly once and peels nested annotated tags', () => {
  const f = changelogFixture()
  try {
    // Import the real two-parent history in one process instead of spawning Git for
    // every add, commit, checkout and revision lookup. Empty trees need no checkout.
    const identity = 'Fixture <fixture@example.invalid> 1735761000 +0200'
    const data = (value: string) => `data ${Buffer.byteLength(value)}\n${value}\n`
    const commit = (mark: number, branch: string, subject: string, parents = '') =>
      `commit refs/heads/${branch}\nmark :${mark}\ncommitter ${identity}\n${data(subject)}${parents}\n`
    execFileSync(
      'git',
      ['-C', f.root, `--git-dir=${join(f.root, '.git')}`, 'fast-import', '--quiet'],
      {
        cwd: f.root,
        env: f.env(),
        input:
          commit(1, 'main', 'feat: initial sample') +
          commit(2, 'main', 'chore: bump version to 1.0.0', 'from :1\n') +
          'reset refs/tags/1.0.0\nfrom :2\n\n' +
          commit(3, 'side', 'fix: side sample', 'from :2\n') +
          commit(4, 'main', 'fix: main sample', 'from :2\n') +
          commit(5, 'main', 'chore: merge sample', 'from :4\nmerge :3\n') +
          commit(6, 'main', 'chore: bump version to 1.1.0', 'from :5\n') +
          `tag sample-inner\nfrom :6\ntagger ${identity}\n${data('Inner sample')}`,
      }
    )
    for (const file of ['manifest.json', 'package.json'])
      writeFileSync(join(f.root, file), JSON.stringify({ version: '1.1.0' }))
    f.git('tag', '-a', '1.1.0', 'sample-inner', '-m', 'Nested sample')
    const releases = generateChangelog(f.root, { historical: [] })
    expect(releases[0].fixes.sort()).toEqual(['Main sample', 'Side sample'])
    expect(releases[0].features).toEqual([])
    expect(releases[1].features).toEqual(['Initial sample'])
    expect(releases[1].fixes).toEqual([])
  } finally {
    f.dispose()
  }
  // Real Git subprocesses can be delayed by concurrent checks; assertions guard correctness.
}, 30_000)
