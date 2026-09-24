/**
 * Where searchable code comes from: the file list at a commit, the archive turned into an index —
 * refused before downloading when the repository is over the limit — the pull request's own
 * diffs, and GitHub's code search for what is too big.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import {
  TooLargeError,
  githubCodeSearch,
  indexes,
  loadTree,
  matchFileNames,
  repoIndex,
  resolveSha,
} from '@/github/search/source'
import { searchChanges } from '@/github/search/changes'
import type { DiffFile } from '@/github/api'

const archive = readFileSync(resolve(__dirname, '../fixtures/github/widgets.tar.gz'))
const SHA = '9bafc7b0401748aa7ce64a89653af1a32c4c6143'
const REPO = { host: 'github.com', owner: 'acme', repo: 'widgets' }

type Reply = { status?: number; json?: unknown; text?: string; bytes?: Uint8Array }

function client(routes: Record<string, Reply>, token = 'tkn', server = '') {
  const ends = endpoints(server)
  const request = vi.fn(async (req: RequestUrlParam): Promise<RequestUrlResponse> => {
    const path = req.url.replace(ends.api, '')
    const r = routes[path] ?? { status: 404, json: { message: 'Not Found' } }
    const bytes = r.bytes ?? new Uint8Array()
    return {
      status: r.status ?? 200,
      headers: {},
      json: r.json,
      text: r.text ?? JSON.stringify(r.json ?? null),
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as RequestUrlResponse
  })
  return { client: new GithubClient(ends, token, request), request }
}

const tree = (truncated = false, size = 100) => ({
  json: {
    truncated,
    tree: [
      { path: 'src', type: 'tree' },
      { path: 'src/app.ts', type: 'blob', size },
      { path: 'src/util/format.ts', type: 'blob', size },
      { path: 'README.md', type: 'blob', size },
    ],
  },
})

beforeEach(() => indexes.clear())

describe('the file list at a commit', () => {
  it('lists the files with their sizes, leaving folders out', async () => {
    const { client: c } = client({ [`/repos/acme/widgets/git/trees/${SHA}?recursive=1`]: tree() })
    const listing = await loadTree(c, REPO, SHA)
    expect(listing.files.map((f) => f.path)).toEqual([
      'src/app.ts',
      'src/util/format.ts',
      'README.md',
    ])
    expect(listing.totalBytes).toBe(300)
    expect(listing.truncated).toBe(false)
  })

  it('says when GitHub cut the list short', async () => {
    const { client: c } = client({
      [`/repos/acme/widgets/git/trees/${SHA}?recursive=1`]: tree(true),
    })
    expect((await loadTree(c, REPO, SHA)).truncated).toBe(true)
  })

  it('matches names by every word, the file name before the folder', () => {
    const files = [
      { path: 'format/index.ts', size: 1 },
      { path: 'src/util/format.ts', size: 1 },
      { path: 'src/app.ts', size: 1 },
    ]
    expect(matchFileNames(files, 'format').map((f) => f.path)).toEqual([
      'src/util/format.ts',
      'format/index.ts',
    ])
    expect(matchFileNames(files, 'src ts').map((f) => f.path)).toEqual([
      'src/app.ts',
      'src/util/format.ts',
    ])
  })
})

describe('resolving the commit', () => {
  it('asks for the default branch when no ref is given', async () => {
    const { client: c } = client({
      '/repos/acme/widgets': { json: { default_branch: 'trunk' } },
      '/repos/acme/widgets/commits/trunk': { text: SHA },
    })
    expect(await resolveSha(c, REPO)).toBe(SHA)
  })

  it('takes a full SHA as it is, without a request', async () => {
    const { client: c, request } = client({})
    expect(await resolveSha(c, REPO, SHA.toUpperCase())).toBe(SHA)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('the repository index', () => {
  const routes = (size = 100, truncated = false) => ({
    [`/repos/acme/widgets/git/trees/${SHA}?recursive=1`]: tree(truncated, size),
    [`/repos/acme/widgets/tarball/${SHA}`]: { bytes: new Uint8Array(archive) },
  })

  it('downloads the archive once and searches it', async () => {
    const { client: c, request } = client(routes())
    const stages: string[] = []
    const index = await repoIndex(c, REPO, SHA, {
      limitBytes: 1e6,
      onStage: (s) => stages.push(s),
    })
    expect(stages).toEqual(['listing', 'downloading', 'unpacking', 'indexing'])
    expect((await index.search({ text: 'formatName' })).files).toHaveLength(2)

    const again = await repoIndex(c, REPO, SHA, { limitBytes: 1e6 })
    expect(again).toBe(index)
    expect(request.mock.calls.filter(([r]) => r.url.includes('tarball'))).toHaveLength(1)
  })

  it('shares one download between two asks at once', async () => {
    const { client: c, request } = client(routes())
    const [a, b] = await Promise.all([
      repoIndex(c, REPO, SHA, { limitBytes: 1e6 }),
      repoIndex(c, REPO, SHA, { limitBytes: 1e6 }),
    ])
    expect(a).toBe(b)
    expect(request.mock.calls.filter(([r]) => r.url.includes('tarball'))).toHaveLength(1)
  })

  it('refuses a repository over the limit before downloading anything', async () => {
    const { client: c, request } = client(routes(10 * 1024 * 1024))
    await expect(repoIndex(c, REPO, SHA, { limitBytes: 1024 * 1024 })).rejects.toBeInstanceOf(
      TooLargeError
    )
    expect(request.mock.calls.some(([r]) => r.url.includes('tarball'))).toBe(false)
  })

  it('refuses a repository GitHub would not list whole', async () => {
    const { client: c } = client(routes(1, true))
    await expect(repoIndex(c, REPO, SHA, { limitBytes: 1e9 })).rejects.toThrow(/whole repository/)
  })

  it('asks an Enterprise server at its own API address', async () => {
    const ends = endpoints('https://github.example.com')
    const { client: c, request } = client(routes(), 'tkn', 'https://github.example.com')
    await repoIndex(c, { ...REPO, host: 'github.example.com' }, SHA, { limitBytes: 1e6 })
    expect(request.mock.calls.map(([r]) => r.url)).toContain(
      `${ends.api}/repos/acme/widgets/tarball/${SHA}`
    )
  })
})

describe("GitHub's code search, for what is too big", () => {
  it('returns the files with the fragments GitHub matched', async () => {
    const q = encodeURIComponent('formatName repo:acme/widgets')
    const { client: c, request } = client({
      [`/search/code?q=${q}&per_page=50`]: {
        json: {
          total_count: 1,
          items: [{ path: 'src/app.ts', text_matches: [{ fragment: 'return formatName(x)' }] }],
        },
      },
    })
    const result = await githubCodeSearch(c, REPO, 'formatName')
    expect(result.files.map((f) => f.path)).toEqual(['src/app.ts'])
    expect(result.fragments['src/app.ts']).toEqual(['return formatName(x)'])
    expect(request.mock.calls[0][0].headers?.Accept).toContain('text-match')
  })

  it('says it needs a token rather than asking without one', async () => {
    const { client: c } = client({}, '')
    await expect(githubCodeSearch(c, REPO, 'x')).rejects.toThrow(/needs a token/)
  })
})

describe("searching a pull request's changes", () => {
  const diff = (path: string, patch?: string, status = 'modified'): DiffFile => ({
    path,
    status,
    additions: 0,
    deletions: 0,
    patch,
    hash: `h-${path}`,
    reviewComments: [],
  })

  it('numbers a match by its line in the file, on the side it is on', async () => {
    const files = [diff('a.ts', '@@ -10,3 +10,3 @@\n keep x\n-old x\n+new x')]
    const result = await searchChanges(files, { text: 'x' })
    expect(result.files[0].matches.map((m) => `${m.side}${m.line}`)).toEqual(['R10', 'L11', 'R11'])
    expect(result.files[0].hash).toBe('h-a.ts')
  })

  it('never matches the hunk header', async () => {
    const files = [diff('a.ts', '@@ -1,1 +1,1 @@ function x\n-a\n+b')]
    expect((await searchChanges(files, { text: 'function' })).files).toEqual([])
  })

  it('reads a file without a diff whole, and leaves a removed one alone', async () => {
    const fetchWhole = vi.fn(async () => 'one\nneedle')
    const files = [diff('big.ts'), diff('gone.ts', undefined, 'removed')]
    const result = await searchChanges(files, { text: 'needle' }, { fetchWhole })
    expect(fetchWhole).toHaveBeenCalledTimes(1)
    expect(result.files[0].matches[0]).toMatchObject({ line: 2, side: 'R' })
  })

  it('narrows to a glob', async () => {
    const files = [diff('a.ts', '@@ -1 +1 @@\n+x'), diff('b.py', '@@ -1 +1 @@\n+x')]
    const result = await searchChanges(files, { text: 'x' }, { glob: '*.py' })
    expect(result.files.map((f) => f.path)).toEqual(['b.py'])
  })
})

describe('where a result opens', () => {
  it('opens a line of a markdown file as its code, and the file itself rendered', async () => {
    const { blobUrl } = await import('@/github/search/tabCode')
    const { parseGithubUrl } = await import('@/github/urls')
    const { blobMode } = await import('@/github/markdownPreview')
    const mode = (url: string) => {
      const t = parseGithubUrl(url, ['github.com'])
      if (t?.kind !== 'blob') throw new Error('not a file')
      return blobMode({ path: t.rest.slice(1).join('/'), lines: t.lines, plain: t.plain })
    }
    const line = blobUrl(REPO, SHA, 'docs/guide.md', 12)
    expect(line).toBe(`https://github.com/acme/widgets/blob/${SHA}/docs/guide.md?plain=1#L12`)
    expect(mode(line)).toBe('code')
    expect(mode(blobUrl(REPO, SHA, 'docs/guide.md'))).toBe('preview')
    expect(blobUrl(REPO, SHA, 'src/app.ts', 3)).toBe(
      `https://github.com/acme/widgets/blob/${SHA}/src/app.ts#L3`
    )
  })
})
