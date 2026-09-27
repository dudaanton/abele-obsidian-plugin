/**
 * The pieces of a repository's front page that need no tab: how GitHub's answers are read, the
 * languages as shares, counts as GitHub writes them, the page's own address, and the refs the
 * switcher offers for what is typed.
 */
import { describe, it, expect } from 'vitest'
import { formatCount, homeUrl, languageShares, repoMeta } from '@/github/repoPage/repoHome'
import { refRows } from '@/github/repoPage/RefPicker'

const repo = { host: 'github.com', owner: 'o', repo: 'r' }

describe('the repository as GitHub describes it', () => {
  it('takes the watchers from the subscribers, not the stars again', () => {
    const meta = repoMeta({ stargazers_count: 10, watchers_count: 10, subscribers_count: 3 }, repo)
    expect(meta.stars).toBe(10)
    expect(meta.watchers).toBe(3)
  })

  it('names the licence by its SPDX id, or by its name when GitHub has none', () => {
    expect(repoMeta({ license: { spdx_id: 'MIT', name: 'MIT License' } }, repo).license).toBe('MIT')
    expect(repoMeta({ license: { spdx_id: 'NOASSERTION', name: 'Other' } }, repo).license).toBe(
      'Other'
    )
    expect(repoMeta({ license: null }, repo).license).toBeNull()
  })

  it('answers under its new name when renamed, and says it is private when it is', () => {
    const meta = repoMeta({ name: 'new', owner: { login: 'acme' }, private: true }, repo)
    expect([meta.owner, meta.name, meta.visibility]).toEqual(['acme', 'new', 'private'])
  })
})

describe('languages', () => {
  it('are shares of the whole, the largest first', () => {
    expect(languageShares({ CSS: 250, TypeScript: 750 })).toEqual([
      { name: 'TypeScript', percent: 75 },
      { name: 'CSS', percent: 25 },
    ])
  })

  it('past seven, the rest are one "Other"', () => {
    const bytes = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`L${i}`, 100 - i])
    ) as Record<string, number>
    const shares = languageShares(bytes)
    expect(shares).toHaveLength(8)
    expect(shares[7].name).toBe('Other')
    expect(shares.reduce((n, s) => n + s.percent, 0)).toBeCloseTo(100, 0)
  })

  it('are none for a repository with no code GitHub counts', () => {
    expect(languageShares({})).toEqual([])
  })
})

describe('counts', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1k'],
    [1234, '1.2k'],
    [12_345, '12k'],
    [1_150_000, '1.1m'],
  ])('%d is %s', (n, text) => {
    expect(formatCount(n)).toBe(text)
  })
})

describe("the page's address", () => {
  it('is the repository itself at the default branch, and tree/<ref> at any other', () => {
    expect(homeUrl(repo)).toBe('https://github.com/o/r')
    expect(homeUrl(repo, 'main', 'main')).toBe('https://github.com/o/r')
    expect(homeUrl(repo, 'feature/paging', 'main')).toBe(
      'https://github.com/o/r/tree/feature/paging'
    )
  })
})

describe('the branch and tag switcher', () => {
  const lists = [
    { branches: ['main', 'dev', 'feature/main-menu'], tags: ['v1.0', 'v2.0'], more: false },
  ]

  it('offers the branches, then the tags', () => {
    expect(refRows(lists, '').map((r) => `${r.kind}:${r.name}`)).toEqual([
      'branch:main',
      'branch:dev',
      'branch:feature/main-menu',
      'tag:v1.0',
      'tag:v2.0',
    ])
  })

  it('narrows to what holds the typed text, what starts with it first', () => {
    expect(refRows(lists, 'ma').map((r) => r.name)).toEqual(['main', 'feature/main-menu'])
    expect(refRows(lists, 'V2').map((r) => r.name)).toEqual(['v2.0'])
  })

  it('takes a ref once when two lists both hold it', () => {
    const more = [...lists, { branches: ['dev', 'devel'], tags: [], more: false }]
    expect(refRows(more, 'dev').map((r) => r.name)).toEqual(['dev', 'devel'])
  })
})
