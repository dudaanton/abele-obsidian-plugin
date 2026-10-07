import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BasePins, PIN_KEY, repositoryKey } from '@/github/comparison/pins'
import { compareTrees } from '@/github/comparison/trees'
import { fullDiff, decodeBlob } from '@/github/comparison/text'
import { comparisonService } from '@/github/comparison/service'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { buildTree, type TreeEntry } from '@/github/tree/fileTree'
import { forgetRepoTrees } from '@/github/tree/repoTree'
import { clientWith } from '../helpers/githubTab'

const BASE = 'a'.repeat(40), TARGET = 'b'.repeat(40)
const REPO = { host: 'github.com', owner: 'sample', repo: 'project' }
const entry = (path: string, sha: string, mode = '100644'): TreeEntry => ({ path, sha, mode, type: 'blob', size: 4 })
const tree = (entries: TreeEntry[]) => ({ tree: entries, truncated: false })
const blob = (text: string) => ({ encoding: 'base64', content: btoa(text) })
beforeEach(() => forgetRepoTrees())

describe('device-local frozen bases', () => {
  it('persists resolved commits, canonicalizes repository identity, and notifies other tabs', async () => {
    const storage = new Map<string, unknown>()
    const app = { loadLocalStorage: (key: string) => storage.get(key), saveLocalStorage: (key: string, value: unknown) => { storage.set(key, value) } }
    const pins = new BasePins(app)
    const { client, request } = clientWith({ '/repos/sample/project/commits/topic%2Fwork': { text: BASE } })
    await pins.pin(client, REPO, 'topic/work')
    expect(pins.get({ ...REPO, owner: 'SAMPLE' })).toMatchObject({ enteredRef: 'topic/work', baseSha: BASE })
    expect(new BasePins(app).get(REPO)?.baseSha).toBe(BASE)
    expect(storage.has(PIN_KEY)).toBe(true)
    expect(repositoryKey({ ...REPO, origin: 'http://git.example.test:8080' })).not.toBe(repositoryKey({ ...REPO, origin: 'https://git.example.test:8080' }))
    expect(request).toHaveBeenCalledTimes(1)
    pins.unpin(REPO)
    expect(pins.get(REPO)).toBeNull()
  })
})

describe('exact endpoint trees', () => {
  it('includes behind/divergent changes, modes, deletion, unique renames and ambiguous additions', async () => {
    const base = buildTree([entry('old.ts', 'same'), entry('gone.ts', 'gone'), entry('mode.sh', 'm'), entry('copy-a', 'copy'), entry('copy-b', 'copy')])
    const target = buildTree([entry('new.ts', 'same'), entry('mode.sh', 'm', '100755'), entry('copy-c', 'copy')])
    const rows = await compareTrees({ root: base, expand: async () => {} }, { root: target, expand: async () => {} })
    expect(rows.find(r => r.path === 'new.ts')).toMatchObject({ status: 'renamed', previousPath: 'old.ts' })
    expect(rows.find(r => r.path === 'gone.ts')?.status).toBe('removed')
    expect(rows.find(r => r.path === 'mode.sh')?.status).toBe('mode changed')
    expect(rows.filter(r => r.path.startsWith('copy')).map(r => r.status).sort()).toEqual(['added', 'removed', 'removed'])
  })

  it('walks differing lazy folders without expanding identical subtrees or depending on UI state', async () => {
    const a = buildTree([{ path: 'same', type: 'tree', sha: 'same' }, { path: 'changed', type: 'tree', sha: 'a' }])
    const b = buildTree([{ path: 'same', type: 'tree', sha: 'same' }, { path: 'changed', type: 'tree', sha: 'b' }])
    for (const root of [a, b]) for (const dir of root.children!) delete dir.children
    const expand = vi.fn(async (node) => { node.children = [ { ...buildTree([entry('file', node.sha)]).children![0], path: `${node.path}/file` } ] })
    const rows = await compareTrees({ root: a, expand }, { root: b, expand })
    expect(rows.map(r => r.path)).toEqual(['changed/file'])
    expect(expand.mock.calls.map(([n]) => n.path)).toEqual(['changed', 'changed'])
  })

  it('does not cap the changed-only index at the compare API limit', async () => {
    const rows = await compareTrees({ root: buildTree([]), expand: async () => {} }, { root: buildTree(Array.from({ length: 350 }, (_, i) => entry(`file-${i}`, String(i)))), expand: async () => {} })
    expect(rows).toHaveLength(350)
  })
})

describe('full text and target line maps', () => {
  it('keeps context outside hunks and counts exact added/removed lines', () => {
    const result = fullDiff('one\ntwo\nthree\n', 'one\nnew\nthree\n')
    expect(result.additions).toBe(1)
    expect(result.deletions).toBe(1)
    expect(result.lines.find(l => l.new === 3)).toMatchObject({ type: 'ctx', text: 'three', old: 3 })
  })
  it('preserves empty files, trailing newline changes, and CRLF differences', () => {
    expect(fullDiff('', '').lines).toEqual([])
    expect(fullDiff('', '\n')).toMatchObject({ additions: 1, deletions: 0 })
    expect(fullDiff('line', 'line\n')).toMatchObject({ additions: 1, deletions: 1 })
    expect(fullDiff('line\r\n', 'line\n')).toMatchObject({ additions: 1, deletions: 1 })
  })
  it('detects binary and unsupported UTF-8 before decoding, and identifies LFS pointers', () => {
    expect(decodeBlob(new Uint8Array([0, 65])).kind).toBe('binary')
    expect(decodeBlob(new Uint8Array([255, 254, 65, 0])).kind).toBe('unsupported')
    expect(decodeBlob(new TextEncoder().encode('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n')).kind).toBe('lfs')
  })
})

describe('comparison reads', () => {
  const routes = {
    '/repos/sample/project/commits/topic%2Fwork': { text: TARGET },
    [`/repos/sample/project/git/trees/${BASE}`]: { json: tree([entry('src/file.ts', 'old'), entry('gone.ts', 'gone')]) },
    [`/repos/sample/project/git/trees/${TARGET}`]: { json: tree([entry('src/file.ts', 'new')]) },
    '/repos/sample/project/git/blobs/old': { json: blob('old\n') },
    '/repos/sample/project/git/blobs/new': { json: blob('new\n') },
    '/repos/sample/project/git/blobs/gone': { json: blob('gone\n') },
  }
  it('resolves slash refs once and uses only immutable trees/blobs; session hits need no network', async () => {
    const { client, request } = clientWith(routes)
    const service = comparisonService(client, REPO)
    const result = await service.open(BASE, ['topic', 'work', 'src', 'file.ts'])
    expect(result.targetSha).toBe(TARGET)
    expect(result.path).toBe('src/file.ts')
    expect(result.text?.lines.map(l => l.type)).toEqual(['del', 'add'])
    expect(request.mock.calls.every(([r]) => !r.url.includes('/contents/'))).toBe(true)
    const calls = request.mock.calls.length
    await service.open(BASE, [TARGET, 'src', 'file.ts'])
    expect(request).toHaveBeenCalledTimes(calls)
    client.retire()
    await expect(service.open(BASE, [TARGET, 'src', 'file.ts'])).rejects.toThrow(/connection changed/)
  })
  it('opens deletion with an empty target without changing the comparison target', async () => {
    const { client } = clientWith(routes)
    const result = await comparisonService(client, REPO).open(BASE, [TARGET, 'gone.ts'])
    expect(result.targetSha).toBe(TARGET)
    expect(result.change.status).toBe('removed')
    expect(result.text).toMatchObject({ additions: 0, deletions: 1 })
  })
  it('waits out primary and secondary rate refusals without switching identities or re-requesting', async () => {
    const request = vi.fn(async () => ({ status: 429, headers: { 'Retry-After': '60' }, json: { message: 'secondary rate limit' }, text: '', arrayBuffer: new ArrayBuffer(0) }))
    const client = new GithubClient(endpoints(''), '', request)
    await expect(client.get('/rate-test')).rejects.toMatchObject({ kind: 'rate-limit' })
    await expect(client.get('/rate-test')).rejects.toMatchObject({ kind: 'rate-limit' })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
