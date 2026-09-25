/**
 * Which GitHub links open inside Obsidian, and what each one points at.
 *
 * Anything this does not recognise must come back `null` — the link then goes to the browser as
 * it always did, which is the whole promise of "unsupported URLs still work".
 */
import { describe, it, expect } from 'vitest'
import {
  parseGithubUrl,
  endpoints,
  diffAnchorHash,
  blobCandidates,
  shortName,
  targetKey,
} from '@/github/urls'
import { compareUrl } from '@/github/compare'

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

describe('comparisons', () => {
  const H = 'https://github.com/octocat/Hello-World/compare'

  it('reads base...head', () => {
    expect(parse(`${H}/master...octocat-patch-1`)).toEqual({
      kind: 'compare',
      host: 'github.com',
      owner: 'octocat',
      repo: 'Hello-World',
      base: 'master',
      head: 'octocat-patch-1',
      direct: false,
      file: undefined,
      anchor: undefined,
    })
  })

  it('reads two dots as the direct comparison', () => {
    expect(parse(`${H}/v1.0..v2.0`)).toMatchObject({ base: 'v1.0', head: 'v2.0', direct: true })
  })

  it('reads one ref as that ref against the default branch', () => {
    expect(parse(`${H}/feature`)).toMatchObject({ base: undefined, head: 'feature' })
  })

  it('keeps branches with slashes, forks, SHAs and tags whole', () => {
    expect(parse(`${H}/release/1.0...feature/login/form`)).toMatchObject({
      base: 'release/1.0',
      head: 'feature/login/form',
    })
    expect(parse(`${H}/main...someone:Hello-World:fix`)).toMatchObject({
      base: 'main',
      head: 'someone:Hello-World:fix',
    })
    expect(parse(`${H}/main...someone:fix`)).toMatchObject({ head: 'someone:fix' })
    expect(parse(`${H}/1a2b3c4...9f8e7d6c5b4a39281706f5e4d3c2b1a098765432`)).toMatchObject({
      base: '1a2b3c4',
      head: '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432',
    })
  })

  it('ignores ?expand=1 and reads a file anchor in the diff', () => {
    const hash = 'b'.repeat(64)
    expect(parse(`${H}/main...dev?expand=1#diff-${hash}R4-R6`)).toMatchObject({
      base: 'main',
      head: 'dev',
      file: { hash, side: 'R', line: 4, endLine: 6 },
    })
  })

  it('reads percent-encoded refs', () => {
    expect(parse(`${H}/main...feature%2Flogin`)).toMatchObject({ head: 'feature/login' })
  })

  it('takes the comparison on a configured Enterprise host', () => {
    expect(
      parseGithubUrl('https://git.example.com/o/r/compare/a...b', ['github.com', 'git.example.com'])
    ).toMatchObject({ kind: 'compare', host: 'git.example.com', base: 'a', head: 'b' })
  })

  it.each([`${H}`, `${H}/...`, `${H}/main...`, `${H}/...dev`, `${H}/a....b`])(
    'leaves %s to the browser',
    (url) => {
      expect(parse(url)).toBeNull()
    }
  )

  it('names the tab and keys the item by its two sides', () => {
    const t = parse(`${H}/master...octocat-patch-1#diff-${'c'.repeat(64)}`)!
    expect(shortName(t)).toBe('octocat/Hello-World master...octocat-patch-1')
    expect(targetKey(t)).toBe('compare:github.com/octocat/hello-world/master...octocat-patch-1')
    expect(targetKey(parse(`${H}/master..octocat-patch-1`)!)).not.toBe(targetKey(t))
    expect(shortName(parse(`${H}/feature`)!)).toBe('octocat/Hello-World compare feature')
  })

  it('writes the address back, sides swapped when asked', () => {
    const repo = { host: 'github.com', owner: 'octocat', repo: 'Hello-World' }
    expect(compareUrl(repo, 'main', 'feature/x')).toBe(`${H}/main...feature/x`)
    expect(compareUrl(repo, 'v1', 'v2', true)).toBe(`${H}/v1..v2`)
    expect(compareUrl(repo, 'main', 'someone:Hello-World:fix')).toBe(
      `${H}/main...someone:Hello-World:fix`
    )
  })
})

describe('what stays with the browser', () => {
  it.each([
    'https://github.com/o/r',
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
      origin: 'https://github.com',
    })
  })

  it('puts an Enterprise Server behind /api/v3', () => {
    expect(endpoints('https://git.corp.example/')).toEqual({
      webHost: 'git.corp.example',
      api: 'https://git.corp.example/api/v3',
      graphql: 'https://git.corp.example/api/graphql',
      origin: 'https://git.corp.example',
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
      origin: 'https://acme.ghe.com',
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
