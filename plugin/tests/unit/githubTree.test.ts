/**
 * Folders of a repository: the `tree/…` links that now open in a tab, the breadcrumbs from a file
 * up to its repository, the file tree built from GitHub's flat list, its filter, the folders a
 * too-large repository is read one at a time, and whether the tree panel starts open.
 *
 * The owner opens a link to lines of a file and wants the context around it — the folder, the
 * files next to it — without a trip to the browser.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { parseGithubUrl, shortName, targetKey, treeCandidates, endpoints } from '@/github/urls'
import {
  ancestors,
  buildTree,
  crumbs,
  filterTree,
  findNode,
  treeUrl,
  type TreeEntry,
} from '@/github/tree/fileTree'
import {
  folderEntries,
  formatSize,
  loadFolder,
  readmeOf,
  NotAFolderError,
} from '@/github/tree/folder'
import { forgetRepoTrees, repoTree } from '@/github/tree/repoTree'
import { initialPanel, PANEL_KEY, rememberPanel } from '@/github/tree/panel'
import { linkRef } from '@/github/tree/version'
import { FolderError, loadBlob } from '@/github/api'
import { GithubClient } from '@/github/client'
import { hrefAction } from '@/github/markdownLinks'
import { useVault } from '../helpers/testEnv'

const parse = (url: string) => parseGithubUrl(url, ['github.com'])
const REPO = { host: 'github.com', owner: 'acme', repo: 'widgets' }

type Reply = { status?: number; json?: unknown; text?: string }
function clientWith(routes: Record<string, Reply>) {
  const request = vi.fn(async (req: RequestUrlParam): Promise<RequestUrlResponse> => {
    const path = req.url.replace('https://api.github.com', '')
    const r = routes[path] ?? { status: 404, json: { message: 'Not Found' } }
    return {
      status: r.status ?? 200,
      headers: {},
      json: r.json,
      text: r.text ?? JSON.stringify(r.json ?? null),
      arrayBuffer: new ArrayBuffer(0),
    } as RequestUrlResponse
  })
  return { client: new GithubClient(endpoints(''), '', request), request }
}

beforeEach(() => {
  useVault([])
  forgetRepoTrees()
})

describe('a folder link', () => {
  it('opens in a tab: the ref and the path after tree/', () => {
    expect(parse('https://github.com/acme/widgets/tree/main/src/util')).toEqual({
      kind: 'tree',
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
      rest: ['main', 'src', 'util'],
      anchor: undefined,
    })
    expect(parse('https://github.com/acme/widgets/tree/main')).toMatchObject({
      kind: 'tree',
      rest: ['main'],
    })
  })

  it('keeps a branch with slashes whole, to be settled by asking', () => {
    const t = parse('https://github.com/acme/widgets/tree/feature/paging/src')
    expect(t).toMatchObject({ kind: 'tree', rest: ['feature', 'paging', 'src'] })
    expect(treeCandidates(['feature', 'paging', 'src'])).toEqual([
      { ref: 'feature', path: 'paging/src' },
      { ref: 'feature/paging', path: 'src' },
      { ref: 'feature/paging/src', path: '' },
    ])
    expect(treeCandidates(['main'])).toEqual([{ ref: 'main', path: '' }])
  })

  it('is one item per folder and ref, and names its tab by the folder', () => {
    const t = parse('https://github.com/Acme/Widgets/tree/main/src/util')!
    expect(targetKey(t)).toBe('tree:github.com/acme/widgets/main/src/util')
    expect(shortName(t)).toBe('Acme/Widgets: util/')
    expect(shortName(parse('https://github.com/acme/widgets/tree/main')!)).toBe('acme/widgets')
  })

  it('a bare tree/ with no ref still goes to the browser', () => {
    expect(parse('https://github.com/acme/widgets/tree')).toBeNull()
  })

  it('a folder link in a rendered README now opens in the tab, at the same ref', () => {
    const file = { ...REPO, ref: 'feature/x', path: 'docs/guide.md' }
    expect(hrefAction('../', file)).toEqual({
      kind: 'repo',
      url: 'https://github.com/acme/widgets/tree/feature/x',
    })
    expect(hrefAction('examples/', file)).toEqual({
      kind: 'repo',
      url: 'https://github.com/acme/widgets/tree/feature/x/docs/examples',
    })
  })
})

describe('breadcrumbs', () => {
  it('lead from a file up to its repository, every folder a link at the same ref', () => {
    expect(crumbs(REPO, 'feature/paging', 'src/util/format.ts')).toEqual([
      { label: 'acme' },
      { label: 'widgets', url: 'https://github.com/acme/widgets/tree/feature/paging' },
      { label: 'src', url: 'https://github.com/acme/widgets/tree/feature/paging/src' },
      { label: 'util', url: 'https://github.com/acme/widgets/tree/feature/paging/src/util' },
      { label: 'format.ts' },
    ])
  })

  it('stop at the folder shown, which is not a link to itself', () => {
    expect(crumbs(REPO, 'main', 'src')).toEqual([
      { label: 'acme' },
      { label: 'widgets', url: 'https://github.com/acme/widgets/tree/main' },
      { label: 'src' },
    ])
    expect(crumbs(REPO, 'main', '')).toEqual([{ label: 'acme' }, { label: 'widgets' }])
  })

  it('encode each part of a path, and keep the slashes of a branch', () => {
    expect(treeUrl(REPO, 'feature/a b', 'docs/über')).toBe(
      'https://github.com/acme/widgets/tree/feature/a%20b/docs/%C3%BCber'
    )
  })
})

describe('the file tree', () => {
  const entries: TreeEntry[] = [
    { path: 'README.md', type: 'blob', size: 120, sha: 'r' },
    { path: 'src', type: 'tree', sha: 's' },
    { path: 'src/app.ts', type: 'blob', size: 300, sha: 'a' },
    { path: 'src/util', type: 'tree', sha: 'u' },
    { path: 'src/util/format.ts', type: 'blob', size: 80, sha: 'f' },
    { path: 'Dockerfile', type: 'blob', size: 40, sha: 'd' },
    { path: 'vendor/lib', type: 'commit', sha: 'c' },
    { path: 'docs/guide.md', type: 'blob', size: 10, sha: 'g' },
  ]

  it('is built from the flat list, folders first, each level sorted by name', () => {
    const root = buildTree(entries)
    expect(root.children!.map((n) => `${n.kind}:${n.name}`)).toEqual([
      'dir:docs',
      'dir:src',
      'dir:vendor',
      'file:Dockerfile',
      'file:README.md',
    ])
    const src = findNode(root, 'src')!
    expect(src.children!.map((n) => n.path)).toEqual(['src/util', 'src/app.ts'])
    expect(findNode(root, 'src/util/format.ts')).toMatchObject({ kind: 'file', size: 80 })
    // A folder GitHub lists only through its files is there all the same.
    expect(findNode(root, 'docs')).toMatchObject({ kind: 'dir' })
    expect(findNode(root, 'vendor/lib')).toMatchObject({ kind: 'submodule' })
  })

  it('opens the folders above a file', () => {
    expect(ancestors('src/util/format.ts')).toEqual(['src', 'src/util'])
    expect(ancestors('README.md')).toEqual([])
  })

  it('filters by name, keeping the folders on the way to each match', () => {
    const f = filterTree(buildTree(entries), 'FORM')
    expect(f.matches).toBe(1)
    expect(f.open).toEqual(['src', 'src/util'])
    expect(f.root.children!.map((n) => n.path)).toEqual(['src'])
    expect(findNode(f.root, 'src')!.children!.map((n) => n.path)).toEqual(['src/util'])
    expect(findNode(f.root, 'src/util')!.children!.map((n) => n.path)).toEqual([
      'src/util/format.ts',
    ])
  })

  it('a folder that matches keeps everything in it', () => {
    const f = filterTree(buildTree(entries), 'util')
    expect(findNode(f.root, 'src/util')!.children!.map((n) => n.name)).toEqual(['format.ts'])
    expect(f.open).toEqual(['src'])
  })

  it('stops counting at the limit and says so', () => {
    const many: TreeEntry[] = Array.from({ length: 30 }, (_, i) => ({
      path: `f${i}.ts`,
      type: 'blob',
    }))
    const f = filterTree(buildTree(many), '.ts', 10)
    expect(f.matches).toBe(10)
    expect(f.capped).toBe(true)
    expect(f.root.children).toHaveLength(10)
  })
})

describe('the tree of a repository, read from GitHub', () => {
  const SHA = 'a'.repeat(40)

  it('is read once per repository and commit', async () => {
    const { client, request } = clientWith({
      [`/repos/acme/widgets/git/trees/${SHA}?recursive=1`]: {
        json: { tree: [{ path: 'a.ts', type: 'blob', size: 1, sha: 'x' }], truncated: false },
      },
    })
    const one = await repoTree(client, REPO, SHA)
    const two = await repoTree(client, REPO, SHA)
    expect(one).toBe(two)
    expect(one.truncated).toBe(false)
    expect(one.root.children!.map((n) => n.name)).toEqual(['a.ts'])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('too large to list whole, is read a folder at a time as the folders are opened', async () => {
    const { client, request } = clientWith({
      [`/repos/acme/widgets/git/trees/${SHA}?recursive=1`]: {
        json: { tree: [{ path: 'a', type: 'tree', sha: 't1' }], truncated: true },
      },
      [`/repos/acme/widgets/git/trees/${SHA}`]: {
        json: {
          tree: [
            { path: 'src', type: 'tree', sha: 't2' },
            { path: 'z.md', type: 'blob', size: 3, sha: 'z' },
          ],
        },
      },
      '/repos/acme/widgets/git/trees/t2': {
        json: { tree: [{ path: 'app.ts', type: 'blob', size: 9, sha: 'p' }] },
      },
    })
    const tree = await repoTree(client, REPO, SHA)
    expect(tree.truncated).toBe(true)
    const src = findNode(tree.root, 'src')!
    expect(src.children).toBeUndefined()
    await tree.expand(src)
    expect(src.children!.map((n) => n.path)).toEqual(['src/app.ts'])
    // Opened again, nothing more is asked.
    await tree.expand(src)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('reaches a file deep in a truncated tree by opening the folders on the way', async () => {
    const { client } = clientWith({
      [`/repos/acme/widgets/git/trees/${SHA}?recursive=1`]: { json: { tree: [], truncated: true } },
      [`/repos/acme/widgets/git/trees/${SHA}`]: {
        json: { tree: [{ path: 'src', type: 'tree', sha: 't2' }] },
      },
      '/repos/acme/widgets/git/trees/t2': {
        json: { tree: [{ path: 'util', type: 'tree', sha: 't3' }] },
      },
      '/repos/acme/widgets/git/trees/t3': {
        json: { tree: [{ path: 'format.ts', type: 'blob', size: 9, sha: 'f' }] },
      },
    })
    const tree = await repoTree(client, REPO, SHA)
    await tree.reveal('src/util/format.ts')
    expect(findNode(tree.root, 'src/util/format.ts')).toMatchObject({ kind: 'file' })
  })
})

describe('a folder shown in a tab', () => {
  it('lists folders, then files, each with its size, and finds the README', () => {
    const entries = folderEntries([
      { name: 'readme.md', path: 'src/readme.md', type: 'file', size: 2048 },
      { name: 'util', path: 'src/util', type: 'dir', size: 0 },
      { name: 'app.ts', path: 'src/app.ts', type: 'file', size: 300 },
      { name: 'lib', path: 'src/lib', type: 'submodule', size: 0 },
    ])
    expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'dir:util',
      'submodule:lib',
      'file:app.ts',
      'file:readme.md',
    ])
    expect(readmeOf(entries)?.path).toBe('src/readme.md')
    expect(formatSize(300)).toBe('300 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('prefers a markdown README to a plain one', () => {
    const entries = folderEntries([
      { name: 'README', path: 'README', type: 'file', size: 1 },
      { name: 'README.md', path: 'README.md', type: 'file', size: 1 },
    ])
    expect(readmeOf(entries)?.name).toBe('README.md')
  })

  it('settles a branch with slashes by asking, the shortest ref first', async () => {
    const { client, request } = clientWith({
      '/repos/acme/widgets/contents/src?ref=feature%2Fpaging': {
        json: [{ name: 'app.ts', path: 'src/app.ts', type: 'file', size: 3 }],
      },
    })
    const t = parse('https://github.com/acme/widgets/tree/feature/paging/src')!
    const folder = await loadFolder(client, t as Extract<typeof t, { kind: 'tree' }>)
    expect(folder).toMatchObject({ ref: 'feature/paging', path: 'src' })
    expect(folder.entries.map((e) => e.name)).toEqual(['app.ts'])
    expect(request.mock.calls.map((c) => c[0].url.replace('https://api.github.com', ''))).toEqual([
      '/repos/acme/widgets/contents/paging/src?ref=feature',
      '/repos/acme/widgets/contents/src?ref=feature%2Fpaging',
    ])
  })

  it('reads the root of a repository', async () => {
    const { client } = clientWith({
      '/repos/acme/widgets/contents?ref=main': {
        json: [{ name: 'src', path: 'src', type: 'dir' }],
      },
    })
    const t = parse('https://github.com/acme/widgets/tree/main')!
    const folder = await loadFolder(client, t as Extract<typeof t, { kind: 'tree' }>)
    expect(folder).toMatchObject({ ref: 'main', path: '' })
  })

  it('a tree link to a file says which file it is, for the tab to show it', async () => {
    const { client } = clientWith({
      '/repos/acme/widgets/contents/src/app.ts?ref=main': {
        json: { type: 'file', name: 'app.ts', path: 'src/app.ts', sha: 'x' },
      },
    })
    const t = parse('https://github.com/acme/widgets/tree/main/src/app.ts')!
    const error = await loadFolder(client, t as Extract<typeof t, { kind: 'tree' }>).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(NotAFolderError)
    expect(error).toMatchObject({ ref: 'main', path: 'src/app.ts' })
  })

  it('a file link to a folder says which folder it is, for the tab to list it', async () => {
    const { client } = clientWith({
      '/repos/acme/widgets/contents/src?ref=main': {
        text: JSON.stringify([{ name: 'a.ts', path: 'src/a.ts', type: 'file', _links: {} }]),
      },
    })
    const t = parse('https://github.com/acme/widgets/blob/main/src')!
    const error = await loadBlob(client, t as Extract<typeof t, { kind: 'blob' }>).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(FolderError)
    expect(error).toMatchObject({ ref: 'main', path: 'src' })
  })
})

describe('the version a tab links at', () => {
  const pull = parse('https://github.com/acme/widgets/pull/7')!
  const commit = parse('https://github.com/acme/widgets/commit/abcdef1')!
  const blob = parse('https://github.com/acme/widgets/blob/main/src/app.ts')!
  const issue = parse('https://github.com/acme/widgets/issues/5')!

  it("is a pull request's head, a commit's own SHA, a file's or folder's ref", () => {
    expect(linkRef(pull, { headSha: 'h'.repeat(40) })).toBe('h'.repeat(40))
    expect(linkRef(commit, { sha: 'c'.repeat(40) })).toBe('c'.repeat(40))
    expect(linkRef(blob, { ref: 'main', path: 'src/app.ts' })).toBe('main')
  })

  it('is the default branch for an issue, asked for separately', () => {
    expect(linkRef(issue, {})).toBeNull()
    expect(linkRef(pull, null)).toBeNull()
  })
})

describe('the tree panel', () => {
  it('starts closed on a phone, and on a desktop as it was last left', () => {
    expect(initialPanel(true, true)).toBe(false)
    expect(initialPanel(false, true)).toBe(true)
    expect(initialPanel(false, null)).toBe(false)
  })

  it('remembers the choice on a desktop only', () => {
    const saved: Record<string, unknown> = {}
    const app = { saveLocalStorage: (k: string, v: unknown) => (saved[k] = v) }
    rememberPanel(app, true, true)
    expect(saved).toEqual({})
    rememberPanel(app, true, false)
    expect(saved).toEqual({ [PANEL_KEY]: true })
  })
})
