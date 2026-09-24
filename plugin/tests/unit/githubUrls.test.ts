/**
 * Which GitHub links open inside Obsidian, and what each one points at.
 *
 * Anything this does not recognise must come back `null` — the link then goes to the browser as
 * it always did, which is the whole promise of "unsupported URLs still work".
 */
import { describe, it, expect } from 'vitest'
import { parseGithubUrl, endpoints, diffAnchorHash, blobCandidates } from '@/github/urls'

const parse = (url: string) => parseGithubUrl(url, ['github.com'])

describe('issues, pull requests and discussions', () => {
  it('reads an issue', () => {
    expect(parse('https://github.com/octo/repo/issues/12')).toEqual({
      kind: 'issue',
      host: 'github.com',
      owner: 'octo',
      repo: 'repo',
      number: 12,
      anchor: undefined,
    })
  })

  it('keeps a comment anchor', () => {
    expect(parse('https://github.com/octo/repo/issues/12#issuecomment-99')?.anchor).toBe(
      'issuecomment-99'
    )
  })

  it('opens the files on a review comment, which is shown beside its file', () => {
    for (const url of [
      'https://github.com/octo/repo/pull/7#discussion_r55',
      'https://github.com/octo/repo/pull/7/files#r55',
      'https://github.com/octo/repo/pull/7/changes#discussion_r55',
    ]) {
      expect(parse(url)).toMatchObject({ kind: 'pull', tab: 'files', anchor: 'discussion_r55' })
    }
    expect(parse('https://github.com/octo/repo/pull/7/commits#r55')).toMatchObject({
      tab: 'commits',
    })
  })

  it('reads a pull request and its tabs', () => {
    expect(parse('https://github.com/octo/repo/pull/7')).toMatchObject({
      kind: 'pull',
      number: 7,
      tab: 'conversation',
    })
    expect(parse('https://github.com/octo/repo/pull/7/files')).toMatchObject({ tab: 'files' })
    expect(parse('https://github.com/octo/repo/pull/7/changes')).toMatchObject({ tab: 'files' })
    expect(parse('https://github.com/octo/repo/pull/7/commits')).toMatchObject({
      tab: 'commits',
    })
  })

  it('reads a file anchor in the diff, with and without a line', () => {
    const hash = 'a'.repeat(64)
    expect(parse(`https://github.com/o/r/pull/7/files#diff-${hash}`)).toMatchObject({
      tab: 'files',
      file: { hash, side: undefined, line: undefined },
    })
    expect(parse(`https://github.com/o/r/pull/7/files#diff-${hash}R42`)).toMatchObject({
      file: { hash, side: 'R', line: 42, endLine: 42 },
    })
    expect(parse(`https://github.com/o/r/pull/7/files#diff-${hash}L3-L9`)).toMatchObject({
      file: { hash, side: 'L', line: 3, endLine: 9 },
    })
    expect(parse(`https://github.com/o/r/pull/7/changes#diff-${hash}R3-R9`)).toMatchObject({
      file: { hash, side: 'R', line: 3, endLine: 9 },
    })
  })

  it('reads a commit inside a pull request as that commit', () => {
    expect(parse('https://github.com/o/r/pull/7/commits/abc1234')).toMatchObject({
      kind: 'commit',
      sha: 'abc1234',
      pull: 7,
    })
  })

  it('reads a commit, with a file anchor', () => {
    const hash = 'b'.repeat(64)
    expect(parse(`https://github.com/o/r/commit/abc1234#diff-${hash}R5`)).toMatchObject({
      kind: 'commit',
      sha: 'abc1234',
      pull: undefined,
      file: { hash, side: 'R', line: 5 },
    })
  })

  it('reads a discussion', () => {
    expect(parse('https://github.com/o/r/discussions/31#discussioncomment-5')).toMatchObject({
      kind: 'discussion',
      number: 31,
      anchor: 'discussioncomment-5',
    })
  })
})

describe('files at a ref', () => {
  it('reads a file with a line range', () => {
    expect(parse('https://github.com/o/r/blob/main/src/a.ts#L10-L20')).toEqual({
      kind: 'blob',
      host: 'github.com',
      owner: 'o',
      repo: 'r',
      rest: ['main', 'src', 'a.ts'],
      lines: { start: 10, end: 20 },
      anchor: undefined,
    })
  })

  it('reads a single line, columns and the plain view', () => {
    expect(parse('https://github.com/o/r/blob/abc/a.ts#L7')?.lines).toEqual({ start: 7, end: 7 })
    expect(parse('https://github.com/o/r/blob/abc/a.ts?plain=1#L7C3-L9C1')?.lines).toEqual({
      start: 7,
      end: 9,
    })
  })

  it('decodes escaped path segments', () => {
    expect(parse('https://github.com/o/r/blob/main/docs/My%20Note.md')).toMatchObject({
      rest: ['main', 'docs', 'My Note.md'],
    })
  })

  it('offers every split of ref and path, shortest ref first', () => {
    expect(blobCandidates(['feature', 'x', 'src', 'a.ts'])).toEqual([
      { ref: 'feature', path: 'x/src/a.ts' },
      { ref: 'feature/x', path: 'src/a.ts' },
      { ref: 'feature/x/src', path: 'a.ts' },
    ])
  })
})

describe('what stays with the browser', () => {
  it.each([
    'https://github.com/o/r',
    'https://github.com/o/r/tree/main/src',
    'https://github.com/o/r/issues',
    'https://github.com/o/r/pulls',
    'https://github.com/o/r/issues/abc',
    'https://github.com/o/r/blob/main',
    'https://github.com/o/r/releases/tag/v1',
    'https://github.com/orgs/o/discussions/1',
    'https://gist.github.com/o/abc',
    'https://example.com/o/r/issues/1',
    'mailto:someone@github.com',
    'not a url',
    '',
  ])('%s', (url) => {
    expect(parse(url)).toBeNull()
  })
})

describe('hosts', () => {
  it('takes www and http', () => {
    expect(parse('http://www.github.com/o/r/issues/1')?.kind).toBe('issue')
  })

  it('takes an Enterprise host only when it is configured', () => {
    expect(parse('https://git.corp.example/o/r/issues/1')).toBeNull()
    expect(
      parseGithubUrl('https://git.corp.example/o/r/issues/1', ['git.corp.example'])
    ).toMatchObject({ kind: 'issue', host: 'git.corp.example' })
  })
})

describe('endpoints', () => {
  it('uses api.github.com when nothing is configured', () => {
    expect(endpoints('')).toEqual({
      webHost: 'github.com',
      api: 'https://api.github.com',
      graphql: 'https://api.github.com/graphql',
    })
  })

  it('puts an Enterprise Server behind /api/v3', () => {
    expect(endpoints('https://git.corp.example/')).toEqual({
      webHost: 'git.corp.example',
      api: 'https://git.corp.example/api/v3',
      graphql: 'https://git.corp.example/api/graphql',
      server: true,
    })
  })

  it('accepts the API address itself', () => {
    expect(endpoints('https://git.corp.example/api/v3').webHost).toBe('git.corp.example')
  })

  it('knows GitHub Enterprise Cloud with data residency', () => {
    expect(endpoints('https://acme.ghe.com')).toEqual({
      webHost: 'acme.ghe.com',
      api: 'https://api.acme.ghe.com',
      graphql: 'https://api.acme.ghe.com/graphql',
    })
  })
})

describe('the diff anchor', () => {
  it('is the SHA-256 of the file path, as GitHub writes it', async () => {
    // Computed independently: printf %s 'README.md' | shasum -a 256
    expect(await diffAnchorHash('README.md')).toBe(
      'b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5'
    )
  })
})
