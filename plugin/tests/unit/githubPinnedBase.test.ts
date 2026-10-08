import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BasePins, PIN_KEY, repositoryKey } from '@/github/comparison/pins'
import { compareTrees, projectTree } from '@/github/comparison/trees'
import { fullDiff, decodeBlob } from '@/github/comparison/text'
import { comparisonService } from '@/github/comparison/service'
import { GithubClient } from '@/github/client'
import { guardedGithubClient } from '@/github/guardedClient'
import { endpoints } from '@/github/urls'
import { buildTree, findNode, type TreeNode, type TreeEntry } from '@/github/tree/fileTree'
import { forgetRepoTrees, repoTree } from '@/github/tree/repoTree'
import { clientWith, type Route } from '../helpers/githubTab'

const BASE = 'a'.repeat(40),
  TARGET = 'b'.repeat(40)
const REPO = { host: 'github.com', owner: 'sample', repo: 'project' }
const entry = (path: string, sha: string, mode = '100644'): TreeEntry => ({
  path,
  sha,
  mode,
  type: 'blob',
  size: 4,
})
const tree = (entries: TreeEntry[]) => ({ tree: entries, truncated: false })
const blob = (text: string) => ({ encoding: 'base64', content: btoa(text) })
beforeEach(() => forgetRepoTrees())

describe('device-local frozen bases', () => {
  it('validates a pasted SHA as a commit before persisting it', async () => {
    const app = { loadLocalStorage: () => undefined, saveLocalStorage: vi.fn() }
    const pins = new BasePins(app)
    const { client } = clientWith({})
    await expect(pins.pin(client, REPO, BASE)).rejects.toMatchObject({ kind: 'not-found' })
    expect(app.saveLocalStorage).not.toHaveBeenCalled()
  })
  it('persists resolved commits, canonicalizes repository identity, and notifies other tabs', async () => {
    const storage = new Map<string, unknown>()
    const app = {
      loadLocalStorage: (key: string) => storage.get(key),
      saveLocalStorage: (key: string, value: unknown) => {
        storage.set(key, value)
      },
    }
    const pins = new BasePins(app)
    const { client, request } = clientWith({
      '/repos/sample/project/commits/topic%2Fwork': { text: BASE },
    })
    await pins.pin(client, REPO, 'topic/work')
    expect(pins.get({ ...REPO, owner: 'SAMPLE' })).toMatchObject({
      enteredRef: 'topic/work',
      baseSha: BASE,
    })
    expect(new BasePins(app).get(REPO)?.baseSha).toBe(BASE)
    expect(storage.has(PIN_KEY)).toBe(true)
    expect(repositoryKey({ ...REPO, origin: 'http://git.example.test:8080' })).not.toBe(
      repositoryKey({ ...REPO, origin: 'https://git.example.test:8080' })
    )
    expect(request).toHaveBeenCalledTimes(1)
    pins.unpin(REPO)
    expect(pins.get(REPO)).toBeNull()
  })
})

describe('exact endpoint trees', () => {
  it('does not mark an existing parent removed when only its deleted child is in the changed projection', async () => {
    const base = buildTree([entry('src/old.ts', 'old'), entry('src/keep.ts', 'keep')]),
      target = buildTree([entry('src/keep.ts', 'keep')])
    const changes = await compareTrees(
      { root: base, expand: async () => {} },
      { root: target, expand: async () => {} }
    )
    for (const changedOnly of [false, true]) {
      const src = findNode(projectTree(target, changes, changedOnly), 'src')!
      expect(src.comparisonStatus).toBeUndefined()
      expect(src.children?.map((n) => n.path)).toContain('src/old.ts')
    }
  })
  it.each([true, false])(
    'keeps both endpoint paths when a file and folder replace each other (base folder: %s)',
    async (baseFolder) => {
      const base = buildTree([entry(baseFolder ? 'pkg/old.ts' : 'pkg', 'old')]),
        target = buildTree([entry(baseFolder ? 'pkg' : 'pkg/new.ts', 'new')])
      const changes = await compareTrees(
        { root: base, expand: async () => {} },
        { root: target, expand: async () => {} }
      )
      const files = (node: TreeNode): string[] =>
        node.kind === 'dir' ? (node.children ?? []).flatMap(files) : [node.path]
      const unique = (node: TreeNode) => {
        const keys = (node.children ?? []).map((child) => `${child.kind}:${child.path}`)
        expect(new Set(keys).size).toBe(keys.length)
        for (const child of node.children ?? []) unique(child)
      }
      for (const changedOnly of [false, true]) {
        const projected = projectTree(target, changes, changedOnly)
        expect(files(projected).sort()).toEqual(['pkg', baseFolder ? 'pkg/old.ts' : 'pkg/new.ts'])
        unique(projected)
      }
      expect(files(target)).toEqual([baseFolder ? 'pkg' : 'pkg/new.ts'])
    }
  )
  it('includes behind/divergent changes, modes, deletion, unique renames and ambiguous additions', async () => {
    const base = buildTree([
      entry('old.ts', 'same'),
      entry('gone.ts', 'gone'),
      entry('mode.sh', 'm'),
      entry('copy-a', 'copy'),
      entry('copy-b', 'copy'),
    ])
    const target = buildTree([
      entry('new.ts', 'same'),
      entry('mode.sh', 'm', '100755'),
      entry('copy-c', 'copy'),
    ])
    const rows = await compareTrees(
      { root: base, expand: async () => {} },
      { root: target, expand: async () => {} }
    )
    expect(rows.find((r) => r.path === 'new.ts')).toMatchObject({
      status: 'renamed',
      previousPath: 'old.ts',
    })
    expect(rows.find((r) => r.path === 'gone.ts')?.status).toBe('removed')
    expect(rows.find((r) => r.path === 'mode.sh')?.status).toBe('mode changed')
    expect(
      rows
        .filter((r) => r.path.startsWith('copy'))
        .map((r) => r.status)
        .sort()
    ).toEqual(['added', 'removed', 'removed'])
  })

  it('walks differing lazy folders without expanding identical subtrees or depending on UI state', async () => {
    const a = buildTree([
      { path: 'same', type: 'tree', sha: 'same' },
      { path: 'changed', type: 'tree', sha: 'a' },
    ])
    const b = buildTree([
      { path: 'same', type: 'tree', sha: 'same' },
      { path: 'changed', type: 'tree', sha: 'b' },
    ])
    for (const root of [a, b]) for (const dir of root.children!) delete dir.children
    const expand = vi.fn(async (node) => {
      node.children = [
        { ...buildTree([entry('file', node.sha)]).children![0], path: `${node.path}/file` },
      ]
    })
    const rows = await compareTrees({ root: a, expand }, { root: b, expand })
    expect(rows.map((r) => r.path)).toEqual(['changed/file'])
    expect(expand.mock.calls.map(([n]) => n.path)).toEqual(['changed', 'changed'])
  })

  it('does not cap the changed-only index at the compare API limit', async () => {
    const rows = await compareTrees(
      { root: buildTree([]), expand: async () => {} },
      {
        root: buildTree(Array.from({ length: 350 }, (_, i) => entry(`file-${i}`, String(i)))),
        expand: async () => {},
      }
    )
    expect(rows).toHaveLength(350)
  })
})

describe('full text and target line maps', () => {
  it('keeps context outside hunks and counts exact added/removed lines', () => {
    const result = fullDiff('one\ntwo\nthree\n', 'one\nnew\nthree\n')
    expect(result.additions).toBe(1)
    expect(result.deletions).toBe(1)
    expect(result.lines.find((l) => l.new === 3)).toMatchObject({
      type: 'ctx',
      text: 'three',
      old: 3,
    })
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
    expect(
      decodeBlob(
        new TextEncoder().encode(
          'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n'
        )
      ).kind
    ).toBe('lfs')
  })
})

describe('lazy tree caller authority', () => {
  it('bounds retirement listeners while nine callers cycle through the eight-tree cache twice', async () => {
    const { client } = clientWith({
      [`/repos/sample/project/git/trees/${TARGET}`]: { json: tree([entry('file.ts', 'file')]) },
    })
    const listeners = (client as unknown as { retireListeners: Set<() => void> }).retireListeners
    const callers = Array.from({ length: 9 }, () => guardedGithubClient(client, () => {}))
    const counts: number[] = []
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const caller of callers) await repoTree(caller, REPO, TARGET)
      counts.push(listeners.size)
    }
    expect(counts).toEqual([8, 8])
    forgetRepoTrees()
    expect(listeners.size).toBe(0)
  })
  it('can unsubscribe an evicted caller after its capability is revoked', async () => {
    const { client } = clientWith({
      [`/repos/sample/project/git/trees/${TARGET}`]: { json: tree([]) },
    })
    let allowed = true
    const first = guardedGithubClient(client, () => {
      if (!allowed) throw new Error('Access revoked')
    })
    await repoTree(first, REPO, TARGET)
    allowed = false
    for (let i = 0; i < 8; i++)
      await repoTree(
        guardedGithubClient(client, () => {}),
        REPO,
        TARGET
      )
    expect((client as unknown as { retireListeners: Set<() => void> }).retireListeners.size).toBe(8)
    client.retire()
    expect((client as unknown as { retireListeners: Set<() => void> }).retireListeners.size).toBe(0)
  })
  const lazyRoutes: Record<string, Route> = {
    [`/repos/sample/project/git/trees/${BASE}`]: (r) => ({
      json: r.url.includes('recursive=1')
        ? { tree: [], truncated: true }
        : tree([{ path: 'hidden', type: 'tree', sha: 'shared-dir' }]),
    }),
    [`/repos/sample/project/git/trees/${TARGET}`]: (r) => ({
      json: r.url.includes('recursive=1')
        ? { tree: [], truncated: true }
        : tree([{ path: 'hidden', type: 'tree', sha: 'shared-dir' }]),
    }),
    '/repos/sample/project/git/trees/shared-dir': { json: tree([entry('private.ts', 'private')]) },
  }
  it.each([false, true])(
    'uses the revoked reader’s own capability for lazy expansion (pinned: %s)',
    async (pinned) => {
      const { client, request } = clientWith(lazyRoutes)
      const user = pinned
        ? (await comparisonService(client, REPO).index(BASE, TARGET)).target
        : await repoTree(client, REPO, TARGET)
      let allowed = true
      const agent = guardedGithubClient(client, () => {
        if (!allowed) throw new Error('Access revoked')
      })
      expect(agent.cacheNamespace).toBe(client.cacheNamespace)
      const shown = pinned
        ? (await comparisonService(agent, REPO).index(BASE, TARGET)).target
        : await repoTree(agent, REPO, TARGET)
      const hidden = findNode(shown.root, 'hidden')!
      expect(hidden.children).toBeUndefined()
      const before = request.mock.calls.length
      allowed = false
      await expect((async () => shown.expand(hidden))()).rejects.toThrow('Access revoked')
      expect(request).toHaveBeenCalledTimes(before)
      expect(hidden.children).toBeUndefined()
      await user.expand(findNode(user.root, 'hidden')!)
      expect(hidden.children).toBeUndefined()
    }
  )
  it('rechecks a cached tree result if the caller is revoked before promise completion', async () => {
    const { client, request } = clientWith(lazyRoutes)
    let allowed = true
    const agent = guardedGithubClient(client, () => {
      if (!allowed) throw new Error('Access revoked')
    })
    await repoTree(agent, REPO, TARGET)
    const before = request.mock.calls.length
    const cached = repoTree(agent, REPO, TARGET)
    allowed = false
    await expect(cached).rejects.toThrow('Access revoked')
    expect(request).toHaveBeenCalledTimes(before)
  })
  it('does not inherit the first reader’s revoked capability when another reader expands a folder', async () => {
    const { client, request } = clientWith(lazyRoutes)
    let allowed = true
    const first = guardedGithubClient(client, () => {
      if (!allowed) throw new Error('Access revoked')
    })
    const old = await repoTree(first, REPO, TARGET),
      current = await repoTree(client, REPO, TARGET)
    allowed = false
    const before = request.mock.calls.length
    await current.expand(findNode(current.root, 'hidden')!)
    expect(findNode(current.root, 'hidden')?.children?.map((n) => n.path)).toEqual([
      'hidden/private.ts',
    ])
    expect(request).toHaveBeenCalledTimes(before + 1)
    expect(findNode(old.root, 'hidden')?.children).toBeUndefined()
  })
})

describe('comparison reads', () => {
  const routes = {
    '/repos/sample/project/commits/topic%2Fwork': { text: TARGET },
    [`/repos/sample/project/git/trees/${BASE}`]: {
      json: tree([entry('src/file.ts', 'old'), entry('gone.ts', 'gone')]),
    },
    [`/repos/sample/project/git/trees/${TARGET}`]: { json: tree([entry('src/file.ts', 'new')]) },
    '/repos/sample/project/git/blobs/old': { json: blob('old\n') },
    '/repos/sample/project/git/blobs/new': { json: blob('new\n') },
    '/repos/sample/project/git/blobs/gone': { json: blob('gone\n') },
  }
  it('opens a renamed file by its base-side name without changing the target', async () => {
    const { client } = clientWith({
      [`/repos/sample/project/git/trees/${BASE}`]: { json: tree([entry('old.ts', 'same')]) },
      [`/repos/sample/project/git/trees/${TARGET}`]: { json: tree([entry('new.ts', 'same')]) },
      '/repos/sample/project/git/blobs/same': { json: blob('same\n') },
    })
    const result = await comparisonService(client, REPO).open(BASE, [TARGET, 'old.ts'])
    expect(result.path).toBe('new.ts')
    expect(result.change).toMatchObject({ status: 'renamed', previousPath: 'old.ts' })
    expect(result.targetSha).toBe(TARGET)
    expect(result.text).toMatchObject({ additions: 0, deletions: 0 })
  })
  it('resolves slash refs once and uses only immutable trees/blobs; session hits need no network', async () => {
    const { client, request } = clientWith(routes)
    const service = comparisonService(client, REPO)
    const result = await service.open(BASE, ['topic', 'work', 'src', 'file.ts'])
    expect(result.targetSha).toBe(TARGET)
    expect(result.path).toBe('src/file.ts')
    expect(result.text?.lines.map((l) => l.type)).toEqual(['del', 'add'])
    expect(request.mock.calls.every(([r]) => !r.url.includes('/contents/'))).toBe(true)
    const calls = request.mock.calls.length
    await service.open(BASE, [TARGET, 'src', 'file.ts'])
    expect(request).toHaveBeenCalledTimes(calls)
    client.retire()
    await expect(service.open(BASE, [TARGET, 'src', 'file.ts'])).rejects.toThrow(
      /connection changed/
    )
  })
  it('never reuses another caller’s capability for credential-scoped cache hits', async () => {
    const { client } = clientWith(routes)
    await comparisonService(client, REPO).open(BASE, [TARGET, 'src', 'file.ts'])
    let allowed = true
    const guarded = guardedGithubClient(client, () => {
      if (!allowed) throw new Error('Access revoked')
    })
    const service = comparisonService(guarded, REPO)
    allowed = false
    await expect(service.open(BASE, [TARGET, 'src', 'file.ts'])).rejects.toThrow('Access revoked')
  })
  it('falls back from truncated recursive trees to complete differing subtrees', async () => {
    const { client, request } = clientWith({
      [`/repos/sample/project/git/trees/${BASE}`]: (r) => ({
        json: r.url.includes('recursive=1')
          ? { tree: [], truncated: true }
          : tree([{ path: 'src', type: 'tree', sha: 'base-dir' }]),
      }),
      [`/repos/sample/project/git/trees/${TARGET}`]: (r) => ({
        json: r.url.includes('recursive=1')
          ? { tree: [], truncated: true }
          : tree([{ path: 'src', type: 'tree', sha: 'target-dir' }]),
      }),
      '/repos/sample/project/git/trees/base-dir': { json: tree([entry('file.ts', 'old')]) },
      '/repos/sample/project/git/trees/target-dir': { json: tree([entry('file.ts', 'new')]) },
    })
    const index = await comparisonService(client, REPO).index(BASE, TARGET)
    expect(index.changes.map((c) => c.path)).toEqual(['src/file.ts'])
    expect(request).toHaveBeenCalledTimes(6)
  })
  it('accepts edited rename metadata only when its endpoints and merge base agree', async () => {
    const renamedRoutes = {
      [`/repos/sample/project/git/trees/${BASE}`]: { json: tree([entry('old.ts', 'old')]) },
      [`/repos/sample/project/git/trees/${TARGET}`]: { json: tree([entry('new.ts', 'new')]) },
    }
    for (const ancestor of [BASE, 'd'.repeat(40)]) {
      const { client, request } = clientWith({
        ...renamedRoutes,
        [`/repos/sample/project/compare/${BASE}...${TARGET}`]: {
          json: {
            merge_base_commit: { sha: ancestor },
            files: [
              { filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', sha: 'new' },
            ],
          },
        },
      })
      const index = await comparisonService(client, REPO).index(BASE, TARGET)
      expect(index.changes.map((c) => c.status)).toEqual(
        ancestor === BASE ? ['renamed'] : ['added', 'removed']
      )
      expect(request.mock.calls.filter(([r]) => r.url.includes('/compare/'))).toHaveLength(1)
    }
  })
  it('uses unavailable counts for binary/submodules, keeps symlink and LFS text, and inspects large sizes first', async () => {
    const nodes = [
      entry('binary.dat', 'binary'),
      entry('large.ts', 'large'),
      entry('link', 'link', '120000'),
      entry('pointer', 'pointer'),
      { path: 'module', sha: 'module', mode: '160000', type: 'commit' },
    ]
    nodes[1].size = 2 * 1024 * 1024
    const { client, request } = clientWith({
      [`/repos/sample/project/git/trees/${BASE}`]: { json: tree([]) },
      [`/repos/sample/project/git/trees/${TARGET}`]: { json: tree(nodes) },
      '/repos/sample/project/git/blobs/binary': { json: blob('\0binary') },
      '/repos/sample/project/git/blobs/large': { json: blob('large\n') },
      '/repos/sample/project/git/blobs/link': { json: blob('../file.ts\n') },
      '/repos/sample/project/git/blobs/pointer': {
        json: blob('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n'),
      },
    })
    const service = comparisonService(client, REPO),
      index = await service.index(BASE, TARGET)
    expect((await service.file(index, 'binary.dat')).text).toBeUndefined()
    expect(index.counts.get('binary.dat')?.state).toBe('unavailable')
    expect((await service.file(index, 'module')).note).toContain('Submodule')
    expect(request.mock.calls.some(([r]) => r.url.endsWith('/git/blobs/module'))).toBe(false)
    expect((await service.file(index, 'large.ts')).canLoadLarge).toBe(true)
    expect(request.mock.calls.some(([r]) => r.url.endsWith('/git/blobs/large'))).toBe(false)
    expect((await service.file(index, 'large.ts', true)).text?.additions).toBe(1)
    expect((await service.file(index, 'link')).note).toContain('not followed')
    expect((await service.file(index, 'pointer')).note).toContain('No payload')
  })
  it('retains loaded comparisons offline and distinguishes an uncached blob from unchanged text', async () => {
    const { client, request } = clientWith(routes)
    const service = comparisonService(client, REPO)
    await service.open(BASE, [TARGET, 'src', 'file.ts'])
    const calls = request.mock.calls.length
    request.mockImplementation(async () => {
      throw new Error('Offline transport')
    })
    expect((await service.open(BASE, [TARGET, 'src', 'file.ts'])).text?.additions).toBe(1)
    expect(request).toHaveBeenCalledTimes(calls)
    const uncached = await service.open(BASE, [TARGET, 'gone.ts'])
    expect(uncached.text).toBeUndefined()
    expect(uncached.note).toContain('Could not reach')
    expect(uncached.index.counts.get('gone.ts')?.state).toBe('unavailable')
  })
  it('does not launch queued blob requests after their last reader cancels', async () => {
    const files = Array.from({ length: 12 }, (_, i) => entry(`file-${i}.ts`, `blob-${i}`))
    const { client } = clientWith({
      [`/repos/sample/project/git/trees/${BASE}`]: { json: tree([]) },
      [`/repos/sample/project/git/trees/${TARGET}`]: { json: tree(files) },
      ...Object.fromEntries(
        files.map((f) => [`/repos/sample/project/git/blobs/${f.sha}`, { json: blob('text\n') }])
      ),
    })
    const service = comparisonService(client, REPO),
      index = await service.index(BASE, TARGET),
      cancel = new AbortController()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = client.get.bind(client)
    const get = vi.spyOn(client, 'get').mockImplementation(async (path, options) => {
      if (path.includes('/git/blobs/')) await gate
      return original(path, options)
    })
    const reads = files.map((f) =>
      service.file(index, f.path, false, cancel.signal).catch((error) => error)
    )
    await vi.waitFor(() =>
      expect(get.mock.calls.filter(([path]) => path.includes('/git/blobs/'))).toHaveLength(3)
    )
    cancel.abort()
    release()
    expect((await Promise.all(reads)).every((result) => result.name === 'AbortError')).toBe(true)
    expect(get.mock.calls.filter(([path]) => path.includes('/git/blobs/'))).toHaveLength(3)
  })
  it('retains deduplicated blob requests when another reader still needs the bytes', async () => {
    const { client } = clientWith(routes)
    const service = comparisonService(client, REPO),
      index = await service.index(BASE, TARGET),
      cancel = new AbortController()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = client.get.bind(client)
    const get = vi.spyOn(client, 'get').mockImplementation(async (path, options) => {
      if (path.includes('/git/blobs/')) await gate
      return original(path, options)
    })
    const first = service.file(index, 'src/file.ts', false, cancel.signal).catch((error) => error)
    const second = service.file(index, 'src/file.ts')
    await vi.waitFor(() =>
      expect(get.mock.calls.filter(([path]) => path.includes('/git/blobs/'))).toHaveLength(2)
    )
    let cancelledBeforeBytes = false,
      remainingFinished = false
    void first.then(() => {
      cancelledBeforeBytes = true
    })
    void second.then(() => {
      remainingFinished = true
    })
    cancel.abort()
    try {
      await vi.waitFor(() => expect(cancelledBeforeBytes).toBe(true))
      expect(remainingFinished).toBe(false)
      expect((await first).name).toBe('AbortError')
    } finally {
      release()
    }
    expect((await second).text).toMatchObject({ additions: 1, deletions: 1 })
    expect(get.mock.calls.filter(([path]) => path.includes('/git/blobs/'))).toHaveLength(2)
  })
  it('keeps a shared tree comparison alive when just one tab cancels', async () => {
    const { client } = clientWith(routes)
    const get = client.get.bind(client)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(client, 'get').mockImplementation(async (path, options) => {
      if (path.includes(`/git/trees/${TARGET}`)) await gate
      return get(path, options)
    })
    const service = comparisonService(client, REPO),
      cancel = new AbortController()
    const first = service.index(BASE, TARGET, cancel.signal),
      second = service.index(BASE, TARGET)
    cancel.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    release()
    expect((await second).changes.map((c) => c.path)).toEqual(['gone.ts', 'src/file.ts'])
  })
  it('decodes explicitly UTF-8 encoded Enterprise blobs through the same immutable reader', async () => {
    const { client } = clientWith({
      ...routes,
      '/repos/sample/project/git/blobs/new': { json: { encoding: 'utf-8', content: 'new\n' } },
    })
    const result = await comparisonService(client, REPO).open(BASE, [TARGET, 'src', 'file.ts'])
    expect(result.text).toMatchObject({ additions: 1, deletions: 1 })
  })
  it('stops uncached requests until the primary rate reset while loaded data remains readable', async () => {
    const reset = Math.ceil(Date.now() / 1000) + 60
    const request = vi.fn(async () => ({
      status: 200,
      headers: {
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Limit': '60',
        'X-RateLimit-Reset': String(reset),
      },
      json: {},
      text: '{}',
      arrayBuffer: new ArrayBuffer(0),
    }))
    const client = new GithubClient(endpoints(''), '', request)
    expect(await client.get('/sample')).toEqual({})
    await expect(client.get('/uncached')).rejects.toMatchObject({ kind: 'rate-limit' })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('opens deletion with an empty target without changing the comparison target', async () => {
    const { client } = clientWith(routes)
    const result = await comparisonService(client, REPO).open(BASE, [TARGET, 'gone.ts'])
    expect(result.targetSha).toBe(TARGET)
    expect(result.change.status).toBe('removed')
    expect(result.text).toMatchObject({ additions: 0, deletions: 1 })
  })
  it('waits out primary and secondary rate refusals without switching identities or re-requesting', async () => {
    const request = vi.fn(async () => ({
      status: 429,
      headers: { 'Retry-After': '60' },
      json: { message: 'secondary rate limit' },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }))
    const client = new GithubClient(endpoints(''), '', request)
    await expect(client.get('/rate-test')).rejects.toMatchObject({ kind: 'rate-limit' })
    await expect(client.get('/rate-test')).rejects.toMatchObject({ kind: 'rate-limit' })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
