// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { generateChangelog } from '../../scripts/changelog.mjs'
import * as historyGit from '../../scripts/changelog-git.mjs'
import { changelogFixture } from '../helpers/changelogFixture'

it('bounds Git queries independently of the number of release boundaries', () => {
  const f = changelogFixture()
  try {
    for (let i = 0; i < 12; i++) {
      f.commit(`feat: sample item ${i}`)
      f.bump(`1.${i}.0`)
    }
    const git = vi.spyOn(historyGit, 'gitAt')
    try {
      const releases = generateChangelog(f.root, { historical: [] })
      expect(releases).toHaveLength(12)
      for (let i = 0; i < 12; i++) {
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
})

it('assigns merged side-branch history exactly once and peels nested annotated tags', () => {
  const f = changelogFixture()
  try {
    f.commit('feat: initial sample')
    f.bump('1.0.0')
    f.git('checkout', '-qb', 'side')
    // Empty commits avoid a synthetic content conflict; the generator must walk both parents.
    f.git('-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fix: side sample')
    f.git('checkout', '-q', 'main')
    f.commit('fix: main sample')
    f.git('merge', '--no-ff', '-m', 'chore: merge sample', 'side')
    f.bump('1.1.0', false)
    f.git('tag', '-a', 'sample-inner', '-m', 'Inner sample')
    f.git('tag', '-a', '1.1.0', 'sample-inner', '-m', 'Nested sample')
    const releases = generateChangelog(f.root, { historical: [] })
    expect(releases[0].fixes.sort()).toEqual(['Main sample', 'Side sample'])
    expect(releases[0].features).toEqual([])
    expect(releases[1].features).toEqual(['Initial sample'])
    expect(releases[1].fixes).toEqual([])
  } finally {
    f.dispose()
  }
})
