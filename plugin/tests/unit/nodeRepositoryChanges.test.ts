import { describe, expect, it, vi } from 'vitest'
import { NodeRepositorySource, WORKING_TREE } from '@/repository/node'
import { applyTreeChanges } from '@/repository/nodeTreeChanges'
import type { TreeNode } from '@/repository/model'
import { nodeRepositoryFixture, identity } from '../helpers/nodeRepositoryFixture'

const file = (path: string, size = 1) => ({
  path,
  name: path.split('/').at(-1)!,
  kind: 'file' as const,
  oid: null,
  size,
})
const folder = (path: string) => ({
  path,
  name: path.split('/').at(-1)!,
  kind: 'directory' as const,
  oid: null,
  size: null,
})
const row = (path: string, kind: TreeNode['kind'] = 'file', children?: TreeNode[]): TreeNode => ({
  name: path.split('/').at(-1)!,
  path,
  kind,
  ...(children ? { children } : {}),
})

describe('applying a node change batch to a file tree', () => {
  const sample = () =>
    row('', 'dir', [
      row('docs', 'dir'),
      row('src', 'dir', [row('src/inner', 'dir', [row('src/inner/deep.ts')]), row('src/a.ts')]),
      row('README.md'),
    ])
  it('keeps every unchanged row object and inserts new rows in the tree order', () => {
    const root = sample()
    const src = root.children![1]!,
      readme = root.children![2]!
    const changed = applyTreeChanges(root, [
      { change: 'added', entry: file('src/b.ts', 3) },
      { change: 'added', entry: folder('assets') },
      { change: 'modified', entry: file('README.md', 9) },
      // A folder never opened is read when it is opened, not kept in step.
      { change: 'added', entry: file('docs/guide.md') },
    ])
    expect(changed).toEqual(['src/b.ts', 'assets', 'README.md', 'docs/guide.md'])
    expect(root.children!.map((c) => c.path)).toEqual(['assets', 'docs', 'src', 'README.md'])
    expect(root.children![2]).toBe(src)
    expect(root.children![3]).toBe(readme)
    expect(readme.size).toBe(9)
    expect(src.children!.map((c) => c.path)).toEqual(['src/inner', 'src/a.ts', 'src/b.ts'])
    expect(root.children![1]!.children).toBeUndefined()
    expect(root.children![0]!.children).toBeUndefined()
  })
  it('moves a renamed folder with what was read under it and removes deleted rows', () => {
    const root = sample()
    const inner = root.children![1]!.children![0]!
    applyTreeChanges(root, [
      { change: 'renamed', from: 'src/inner', entry: folder('lib') },
      { change: 'deleted', path: 'src/a.ts', kind: 'file' },
    ])
    expect(root.children!.map((c) => c.path)).toEqual(['docs', 'lib', 'src', 'README.md'])
    expect(root.children![1]).toBe(inner)
    expect(inner.children![0]!.path).toBe('lib/deep.ts')
    expect(root.children![2]!.children).toEqual([])
  })
  it('changes nothing when a batch repeats what a reread already showed', () => {
    const root = sample()
    const batch = [
      { change: 'added' as const, entry: file('src/b.ts', 3) },
      { change: 'renamed' as const, from: 'src/a.ts', entry: file('src/c.ts') },
      { change: 'deleted' as const, path: 'docs', kind: 'directory' as const },
    ]
    applyTreeChanges(root, batch)
    const shown = JSON.stringify(root)
    applyTreeChanges(root, batch)
    expect(JSON.stringify(root)).toBe(shown)
  })
})

describe('node repository source on the change stream', () => {
  const start = async (changes = true) => {
    const f = nodeRepositoryFixture({ changes })
    const source = new NodeRepositorySource(f.client, identity, {
      node: 'Sample node',
      project: 'Sample project',
    })
    const events = vi.fn()
    source.subscribe(events)
    await source.startWatching()
    return { ...f, source, events }
  }
  it('patches the open tree in place and rereads nothing for an ordinary batch', async () => {
    const { source, events, batch, calls, change } = await start()
    expect(calls.find((c) => c.method === 'repository.v1.watch')!.params).toEqual({
      worktree_id: identity.workspace,
      changes: null,
    })
    expect(events.mock.calls).toEqual([[{ kind: 'workspace' }]])
    events.mockClear()
    const tree = await source.tree(WORKING_TREE)
    const app = tree.root.children!.find((c) => c.path === 'app.ts')!
    const observed = calls.filter((c) => c.method === 'repository.v1.observe').length
    batch(1, {
      complete: true,
      entries: [
        { change: 'added', entry: file('new.ts', 4) },
        { change: 'modified', entry: file('app.ts', 30) },
      ],
      git: {
        head: null,
        branch: 'refs/heads/main',
        detached: false,
        status: [{ path: 'new.ts', entry: { index: '?', worktree: '?', path: 'new.ts' } }],
      },
    })
    expect(tree.root.children!.map((c) => c.path)).toEqual(['app.ts', 'new.ts', 'README.md'])
    expect(tree.root.children![0]).toBe(app)
    expect(app.size).toBe(30)
    expect(events.mock.calls).toEqual([
      [{ kind: 'tree', paths: ['new.ts', 'app.ts'] }],
      [{ kind: 'status', paths: ['new.ts'] }],
    ])
    // Its own saves and ordinary edits come as batches; the hint to reread is not needed.
    change()
    expect(events).toHaveBeenCalledTimes(2)
    // Folders opened later are read at the files as they are now.
    await source.resolve(WORKING_TREE)
    expect(calls.filter((c) => c.method === 'repository.v1.observe').length).toBe(observed + 1)
    source.dispose()
  })
  it('rereads once for an incomplete batch or a missing revision, then follows on', async () => {
    const { source, events, batch } = await start()
    const tree = await source.tree(WORKING_TREE)
    events.mockClear()
    batch(1, { complete: false, reason: 'overflow' })
    expect(events.mock.calls).toEqual([[{ kind: 'workspace' }]])
    batch(3, {
      complete: true,
      entries: [{ change: 'added', entry: file('skipped.ts') }],
      git: null,
    })
    expect(events.mock.calls.at(-1)).toEqual([{ kind: 'workspace' }])
    expect(tree.root.children!.some((c) => c.path === 'skipped.ts')).toBe(false)
    events.mockClear()
    batch(4, { complete: true, entries: [{ change: 'added', entry: file('next.ts') }], git: null })
    expect(events.mock.calls).toEqual([[{ kind: 'tree', paths: ['next.ts'] }]])
    source.dispose()
  })
  it('renews its lease from where it stands and rereads only when the node says it lost track', async () => {
    const { source, events, batch, calls } = await start()
    batch(1, { complete: true, entries: [], git: null })
    events.mockClear()
    await (source as unknown as { renewWatch(): Promise<void> }).renewWatch()
    expect(calls.filter((c) => c.method === 'repository.v1.watch').at(-1)!.params.changes).toEqual({
      stream_id: 'stream-fixture',
      revision: 1,
    })
    expect(events).not.toHaveBeenCalled()
    source.dispose()
  })
  it('keeps the legacy lease and its rereads on a node without the stream', async () => {
    const { source, events, calls, change } = await start(false)
    expect(calls.find((c) => c.method === 'repository.v1.watch')!.params).toEqual({
      worktree_id: identity.workspace,
    })
    events.mockClear()
    change()
    expect(events.mock.calls).toEqual([[{ kind: 'workspace' }]])
    source.dispose()
  })
})
