import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateChangelog } from '../../scripts/changelog.mjs'
import { gitEnvironment } from '../../scripts/changelog-git.mjs'
import { changelogFixture } from '../helpers/changelogFixture'

it('reports unrecognized public subjects for review without shipping them', () => {
  const f = changelogFixture()
  try {
    const hash = f.commit('Something not categorized')
    f.commit('chore: internal only')
    f.bump('1.0.0')
    let unknown: unknown[] = []
    const releases = generateChangelog(f.root, {
      historical: [],
      onUnrecognized: (items: unknown[]) => {
        unknown = items
      },
    })
    expect(unknown).toEqual([{ revision: hash, subject: 'Something not categorized' }])
    expect(releases[0].features).toEqual([])
  } finally {
    f.dispose()
  }
})

it('uses UTC dates, deduplicates exact bullets and keeps maintenance-only releases', () => {
  const f = changelogFixture()
  try {
    const feature = f.commit('feat: visible item')
    f.commit('feat(sample): visible item')
    f.bump('1.0.0')
    f.commit('test: implementation only')
    f.bump('1.1.0')
    const releases = generateChangelog(f.root, { historical: [] })
    expect(releases.map((x) => x.version)).toEqual(['1.1.0', '1.0.0'])
    expect(releases[1].features).toEqual(['Visible item'])
    expect(releases.every((x) => x.date === '2025-01-01')).toBe(true)
    expect(releases[0].features).toEqual([])
    const overridden = generateChangelog(f.root, {
      historical: [],
      overrides: { [feature]: { category: 'fixes', text: 'Readable replacement' } },
    })
    expect(overridden[1].fixes).toEqual(['Readable replacement'])
    expect(overridden[1].features).toEqual(['Visible item'])
  } finally {
    f.dispose()
  }
})

it('recovers an off-line tag and untagged boundary without repeated changes', () => {
  const f = changelogFixture()
  try {
    f.commit('feat: initial item')
    f.bump('1.0.0')
    f.git('checkout', '-qb', 'legacy')
    f.commit('fix: old lineage only')
    f.bump('1.0.1')
    f.git('checkout', '-q', 'main')
    f.commit('fix: replayed improvement')
    const mapped = f.bump('1.0.1', false)
    f.commit('feat: recovered improvement')
    const recovered = f.bump('1.1.0', false)
    f.commit('fix: later improvement')
    f.bump('1.2.0')
    const releases = generateChangelog(f.root, {
      historical: [
        { version: '1.0.1', revision: mapped, date: '2025-01-01', dateSource: 'tag' },
        { version: '1.1.0', revision: recovered, dateSource: 'history' },
      ],
    })
    expect(releases.map((x) => x.version)).toEqual(['1.2.0', '1.1.0', '1.0.1', '1.0.0'])
    expect(releases[0].fixes).toEqual(['Later improvement'])
    expect(releases[1].features).toEqual(['Recovered improvement'])
    expect(releases[1].dateSource).toBe('history')
    expect(releases[2].fixes).toEqual(['Replayed improvement'])
    expect(() =>
      generateChangelog(f.root, { historical: [{ version: '1.0.1', revision: 'f'.repeat(40) }] })
    ).toThrow(/missing.*boundary/)
  } finally {
    f.dispose()
  }
})

it('does not include later tags or post-tag commits in a detached older build', () => {
  const f = changelogFixture()
  try {
    f.commit('feat: initial item')
    const old = f.bump('1.0.0')
    const before = JSON.stringify(generateChangelog(f.root, { historical: [] }))
    f.commit('fix: later fix')
    f.bump('1.1.0')
    f.commit('feat: post-tag item')
    expect(generateChangelog(f.root, { historical: [] })[0].features).toEqual([])
    f.git('checkout', '-q', '--detach', old)
    expect(JSON.stringify(generateChangelog(f.root, { historical: [] }))).toBe(before)
  } finally {
    f.dispose()
  }
})

it('rejects dirty invented versions, shallow history, aliases and non-linear boundaries', () => {
  const f = changelogFixture()
  const shallow = mkdtempSync(join(tmpdir(), 'abele-shallow-'))
  try {
    f.commit('feat: initial item')
    f.bump('1.0.0')
    const manifest = readFileSync(join(f.root, 'manifest.json'))
    const pkg = readFileSync(join(f.root, 'package.json'))
    writeFileSync(join(f.root, 'manifest.json'), '{"version":"1.2.0"}')
    writeFileSync(join(f.root, 'package.json'), '{"version":"1.2.0"}')
    expect(() => generateChangelog(f.root, { historical: [] })).toThrow(
      /current.*boundary|missing.*tag/
    )
    writeFileSync(join(f.root, 'manifest.json'), manifest)
    writeFileSync(join(f.root, 'package.json'), pkg)
    execFileSync('git', ['-C', f.root, 'clone', '-q', '--depth=1', `file://${f.root}`, shallow], {
      cwd: f.root,
      env: gitEnvironment(),
    })
    expect(() => generateChangelog(shallow, { historical: [] })).toThrow(/shallow.*full history/)
    f.git('tag', 'v1.0.0')
    expect(() => generateChangelog(f.root, { historical: [] })).toThrow(/aliases/)
    f.git('tag', '-d', 'v1.0.0')
    f.git('checkout', '-qb', 'side')
    f.commit('feat: side item')
    f.bump('1.1.0')
    f.git('checkout', '-q', 'main')
    f.commit('fix: main item')
    f.bump('1.2.0')
    f.git('merge', '--no-ff', '--no-commit', '-s', 'ours', 'side')
    f.commit('chore: merge history')
    expect(() => generateChangelog(f.root, { historical: [] })).toThrow(/non-linear/)
  } finally {
    rmSync(shallow, { recursive: true, force: true })
    f.dispose()
  }
})

it('builds identical tagged data across clean clones, cwd and timezones', () => {
  const f = changelogFixture()
  const clone = mkdtempSync(join(tmpdir(), 'abele-clean-clone-'))
  const oldCwd = process.cwd(),
    oldTz = process.env.TZ
  try {
    f.commit('feat: sample release')
    f.bump('1.0.0')
    f.git('tag', '-a', '1.0.1', '-m', 'Synthetic annotated release')
    // Same commit cannot be two distinct release boundaries; exercise an annotated tag on
    // a new boundary instead, without deleting or retagging any production history.
    f.git('tag', '-d', '1.0.1')
    f.commit('fix: sample fix')
    f.bump('1.0.1', false)
    f.git('tag', '-a', '1.0.1', '-m', 'Synthetic annotated release')
    const before = JSON.stringify(generateChangelog(f.root, { historical: [] }))
    execFileSync('git', ['-C', f.root, 'clone', '-q', f.root, clone], {
      cwd: f.root,
      env: gitEnvironment(),
    })
    execFileSync('git', ['-C', clone, 'checkout', '-q', '--detach', '1.0.1'], {
      cwd: clone,
      env: gitEnvironment(),
    })
    process.chdir(clone)
    process.env.TZ = 'Pacific/Honolulu'
    expect(JSON.stringify(generateChangelog(clone, { historical: [] }))).toBe(before)
    process.env.TZ = 'Asia/Tokyo'
    expect(JSON.stringify(generateChangelog(clone, { historical: [] }))).toBe(before)
  } finally {
    process.chdir(oldCwd)
    if (oldTz === undefined) delete process.env.TZ
    else process.env.TZ = oldTz
    rmSync(clone, { recursive: true, force: true })
    f.dispose()
  }
})
