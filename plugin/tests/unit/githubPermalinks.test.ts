/**
 * Links to lines and comments inside a GitHub item, as a note keeps them.
 *
 * Each link is written the way GitHub writes it, so it opens the same place on GitHub — and it
 * must also open the same place here: every URL below is parsed back by the plugin's own link
 * reader and has to name the item, the line or the comment it was made from.
 */
import { describe, it, expect } from 'vitest'
import {
  blobLink,
  bodyLink,
  commentLink,
  diffLink,
  diffSpan,
  markdownLink,
  type LinkItem,
} from '@/github/permalinks'
import { parsePatch, linesFor } from '@/github/patch'
import { parseGithubUrl, targetKey, diffAnchorHash } from '@/github/urls'

const HOST = 'github.example.com'
const repo = { host: HOST, owner: 'acme', repo: 'widgets' }
const pull: LinkItem = { ...repo, kind: 'pull', number: 42 }
const issue: LinkItem = { ...repo, kind: 'issue', number: 7 }
const discussion: LinkItem = { ...repo, kind: 'discussion', number: 3 }
const SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
const commit: LinkItem = { ...repo, kind: 'commit', sha: SHA }
const pullCommit: LinkItem = { ...repo, kind: 'commit', sha: SHA, pull: 42 }

const parse = (url: string) => parseGithubUrl(url, ['github.com', HOST])

// Old 10..13, new 10..14: context, removed, added, added, context.
const PATCH = '@@ -10,4 +10,5 @@\n a\n-b\n+c\n+d\n e\n f'
const lines = parsePatch(PATCH)

describe('which side and lines a diff selection names', () => {
  it('an added or unchanged line is on the new side', () => {
    expect(diffSpan(lines, 3, 3)).toEqual({ side: 'R', start: 11, end: 11 })
    expect(diffSpan(lines, 1, 1)).toEqual({ side: 'R', start: 10, end: 10 })
  })

  it('a removed line is on the old side', () => {
    expect(diffSpan(lines, 2, 2)).toEqual({ side: 'L', start: 11, end: 11 })
  })

  it('a range keeps the new side when both ends have it, and is given in order', () => {
    expect(diffSpan(lines, 5, 1)).toEqual({ side: 'R', start: 10, end: 13 })
  })

  it('a range from a removed line to an added one is narrowed to the new side', () => {
    expect(diffSpan(lines, 2, 4)).toEqual({ side: 'R', start: 11, end: 12 })
  })

  it('the hunk header alone names nothing', () => {
    expect(diffSpan(lines, 0, 0)).toBeNull()
  })
})

describe('a link to lines in a diff', () => {
  it('in a pull request: the files tab, the file hash and the side, and back', async () => {
    const hash = await diffAnchorHash('src/app.ts')
    const link = diffLink(pull, { path: 'src/app.ts', hash }, { side: 'R', start: 10, end: 20 })

    expect(link).toEqual({
      label: 'acme/widgets#42 · src/app.ts:10–20',
      url: `https://${HOST}/acme/widgets/pull/42/files#diff-${hash}R10-R20`,
    })
    expect(parse(link.url)).toMatchObject({
      kind: 'pull',
      number: 42,
      tab: 'files',
      file: { hash, side: 'R', line: 10, endLine: 20 },
    })
  })

  it('a single removed line is L, says so in the label, and marks that line when opened', async () => {
    const hash = await diffAnchorHash('src/app.ts')
    const span = diffSpan(lines, 2, 2)!
    const link = diffLink(pull, { path: 'src/app.ts', hash }, span)

    expect(link.url.endsWith(`#diff-${hash}L11`)).toBe(true)
    expect(link.label).toBe('acme/widgets#42 · src/app.ts:11 (before)')
    const t = parse(link.url)
    if (t?.kind !== 'pull' || !t.file?.side) throw new Error('not a diff link')
    expect(linesFor(lines, t.file.side, t.file.line!, t.file.endLine)).toEqual([2])
  })

  it('in a commit, alone or inside its pull request', async () => {
    const hash = await diffAnchorHash('lib/x.ts')
    const alone = diffLink(commit, { path: 'lib/x.ts', hash }, { side: 'R', start: 5, end: 5 })
    const inPull = diffLink(pullCommit, { path: 'lib/x.ts', hash }, { side: 'R', start: 5, end: 5 })

    expect(alone).toEqual({
      label: 'acme/widgets@1a2b3c4 · lib/x.ts:5',
      url: `https://${HOST}/acme/widgets/commit/${SHA}#diff-${hash}R5`,
    })
    expect(parse(alone.url)).toMatchObject({ kind: 'commit', sha: SHA, file: { hash, line: 5 } })
    expect(inPull.url).toBe(`https://${HOST}/acme/widgets/pull/42/commits/${SHA}#diff-${hash}R5`)
    expect(parse(inPull.url)).toMatchObject({ kind: 'commit', sha: SHA, pull: 42 })
  })
})

describe('a link to lines of a file', () => {
  it('is pinned to the commit, not the branch, and reads back to the same lines', () => {
    const link = blobLink(repo, SHA, 'src/app.ts', { from: 10, to: 20 })
    expect(link).toEqual({
      label: `acme/widgets@1a2b3c4 · src/app.ts:10–20`,
      url: `https://${HOST}/acme/widgets/blob/${SHA}/src/app.ts#L10-L20`,
    })
    expect(parse(link.url)).toMatchObject({
      kind: 'blob',
      rest: [SHA, 'src', 'app.ts'],
      lines: { start: 10, end: 20 },
    })
  })

  it('one line, and a path that needs escaping', () => {
    const link = blobLink(repo, SHA, 'docs/read me (draft).md', { from: 3, to: 3 })
    // A markdown file: the link asks for its source, where the lines are.
    expect(link.url.endsWith('/docs/read%20me%20(draft).md?plain=1#L3')).toBe(true)
    expect(parse(link.url)).toMatchObject({
      rest: [SHA, 'docs', 'read me (draft).md'],
      lines: { start: 3, end: 3 },
    })
  })
})

describe('a link to a comment', () => {
  const cases: Array<[LinkItem, string, boolean, string, object]> = [
    [
      pull,
      'issuecomment-123',
      false,
      'acme/widgets#42 · comment by alice',
      { tab: 'conversation' },
    ],
    [
      pull,
      'pullrequestreview-9',
      false,
      'acme/widgets#42 · review by alice',
      { tab: 'conversation' },
    ],
    [pull, 'discussion_r55', false, 'acme/widgets#42 · review comment by alice', { tab: 'files' }],
    [issue, 'issuecomment-5', false, 'acme/widgets#7 · comment by alice', { kind: 'issue' }],
    [
      discussion,
      'discussioncomment-8',
      false,
      'acme/widgets#3 · comment by alice',
      { kind: 'discussion' },
    ],
    [
      discussion,
      'discussioncomment-9',
      true,
      'acme/widgets#3 · reply by alice',
      { kind: 'discussion' },
    ],
  ]

  for (const [item, anchor, reply, label, shape] of cases) {
    it(`${anchor}${reply ? ' (a reply)' : ''} reads back to the same comment`, () => {
      const link = commentLink(item, { anchor, author: 'alice' }, reply)
      expect(link.label).toBe(label)
      const t = parse(link.url)
      expect(t).toMatchObject({ anchor, ...shape })
      expect(targetKey(t!)).toBe(targetKey(parse(bodyLink(item, '').url)!))
    })
  }

  it('the item itself, by its title', () => {
    expect(bodyLink(pull, 'Fix the crash')).toEqual({
      label: 'acme/widgets#42 · Fix the crash',
      url: `https://${HOST}/acme/widgets/pull/42`,
    })
  })
})

describe('the markdown written into a note', () => {
  it('is a link with a readable label', () => {
    expect(
      markdownLink({ label: 'acme/widgets#42 · comment by alice', url: 'https://x/y#z' })
    ).toBe('[acme/widgets#42 · comment by alice](https://x/y#z)')
  })

  it('escapes brackets in the label and parentheses in the address', () => {
    const md = markdownLink({
      label: 'acme/widgets#42 · Fix [urgent] thing',
      url: `https://${HOST}/acme/widgets/blob/${SHA}/a%20(b).md#L1`,
    })
    expect(md).toBe(
      `[acme/widgets#42 · Fix \\[urgent\\] thing](https://${HOST}/acme/widgets/blob/${SHA}/a%20%28b%29.md#L1)`
    )
    // Still the same file once the note hands the address back.
    const url = /\]\((.*)\)$/.exec(md)![1]
    expect(parse(url)).toMatchObject({ rest: [SHA, 'a (b).md'], lines: { start: 1, end: 1 } })
  })
})
