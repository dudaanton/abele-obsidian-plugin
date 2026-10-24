import { describe, expect, it, vi } from 'vitest'
import { RepositoryMethodSchemas } from '@abele/node-protocol'
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
  it('renews its own lease and releases the replaced id on capable nodes', async () => {
    const f = nodeRepositoryFixture({ changes: true })
    f.client.describe = async () => ({
      capabilities: {
        capabilities: {
          repository_changes_v1: { status: 'supported' },
          repository_watch_renewal_v1: { status: 'supported' },
        },
      },
    })
    const original = f.client.repository.watch.bind(f.client.repository)
    let id = 0
    const watch = vi.spyOn(f.client.repository, 'watch').mockImplementation(async (params) => ({
      ...(await original(params)),
      subscription_id: `lease-${++id}`,
    }))
    const source = new NodeRepositorySource(f.client, identity, {
      node: 'Sample',
      project: 'Sample',
    })
    await source.startWatching()
    f.batch(1, { complete: true, entries: [], git: null })
    try {
      await (source as unknown as { renewWatch(): Promise<void> }).renewWatch()
      await (source as unknown as { renewWatch(): Promise<void> }).renewWatch()
      expect(watch.mock.calls.map(([params]) => params)).toEqual([
        { worktree_id: identity.workspace, changes: null },
        {
          worktree_id: identity.workspace,
          subscription_id: 'lease-1',
          changes: { stream_id: 'stream-fixture', revision: 1 },
        },
        {
          worktree_id: identity.workspace,
          subscription_id: 'lease-2',
          changes: { stream_id: 'stream-fixture', revision: 1 },
        },
      ])
      for (const [params] of watch.mock.calls)
        expect(RepositoryMethodSchemas['repository.v1.watch'].parse(params)).toEqual(params)
      expect(
        f.calls
          .filter((c) => c.method === 'repository.v1.unwatch')
          .map((c) => c.params.subscription_id)
      ).toEqual(['lease-1', 'lease-2'])
      watch.mockRejectedValueOnce({ code: 'unauthorized' })
      await (source as unknown as { renewWatch(): Promise<void> }).renewWatch()
      await (source as unknown as { renewWatch(): Promise<void> }).renewWatch()
      expect(watch.mock.calls.at(-1)![0]).toEqual({
        worktree_id: identity.workspace,
        changes: { stream_id: 'stream-fixture', revision: 1 },
      })
      watch.mockRejectedValueOnce({ code: 'disconnected' })
      await (source as unknown as { renewWatch(): Promise<void> }).renewWatch()
      await (source as unknown as { renewWatch(): Promise<void> }).renewWatch()
      expect(watch.mock.calls.at(-1)![0].subscription_id).toBe('lease-4')
    } finally {
      source.dispose()
    }
  })
  /** A promise the test lets go of, for a node answer that is late. */
  const later = () => {
    let release!: () => void
    const promise = new Promise<void>((resolve) => (release = resolve))
    return { promise, release }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  it('patches a tree read while the first lease was still on its way', async () => {
    const lease = later()
    const f = nodeRepositoryFixture({
      changes: true,
      hold: (method) => (method === 'repository.v1.watch' ? lease.promise : undefined),
    })
    const source = new NodeRepositorySource(f.client, identity, {
      node: 'Sample node',
      project: 'Sample project',
    })
    const events = vi.fn()
    source.subscribe(events)
    const watching = source.startWatching()
    // The tab reads its tree at once, beside the watch it has just started.
    const reading = source.tree(WORKING_TREE)
    await settle()
    lease.release()
    await watching
    const tree = await reading
    expect(tree.live).toBe(true)
    events.mockClear()
    const app = tree.root.children!.find((c) => c.path === 'app.ts')!
    f.batch(1, { complete: true, entries: [{ change: 'added', entry: file('new.ts') }], git: null })
    expect(tree.root.children!.map((c) => c.path)).toEqual(['app.ts', 'new.ts', 'README.md'])
    expect(tree.root.children![0]).toBe(app)
    expect(events.mock.calls).toEqual([[{ kind: 'tree', paths: ['new.ts'] }]])
    source.dispose()
  })
  it('follows the stream with a tree asked for at files observed before it', async () => {
    const lease = later()
    const f = nodeRepositoryFixture({
      changes: true,
      hold: (method) => (method === 'repository.v1.watch' ? lease.promise : undefined),
    })
    const source = new NodeRepositorySource(f.client, identity, {
      node: 'Sample node',
      project: 'Sample project',
    })
    // The tab holds an observation from before the watch, and asks for the tree at it later.
    const early = await source.resolve(WORKING_TREE)
    const watching = source.startWatching()
    await settle()
    lease.release()
    await watching
    const tree = await source.tree(early)
    expect(tree.live).toBe(true)
    f.batch(1, { complete: true, entries: [{ change: 'added', entry: file('new.ts') }], git: null })
    expect(tree.root.children!.some((c) => c.path === 'new.ts')).toBe(true)
    source.dispose()
  })
  it('asks a real client, whose describe needs its own object, whether the node streams', async () => {
    const f = nodeRepositoryFixture({ changes: true })
    const answer = f.client.describe!
    // The node client is a class: its describe reads its own fields.
    const client = Object.assign(Object.create(f.client), {
      capabilities: answer,
      describe(this: { capabilities: typeof answer }) {
        return this.capabilities()
      },
    })
    const source = new NodeRepositorySource(client, identity, {
      node: 'Sample node',
      project: 'Sample project',
    })
    await source.startWatching()
    expect(f.calls.find((c) => c.method === 'repository.v1.watch')!.params.changes).toBeNull()
    source.dispose()
  })
  it('keeps the batches that arrive before the first lease answers', async () => {
    const lease = later()
    const f = nodeRepositoryFixture({
      changes: true,
      hold: (method) => (method === 'repository.v1.watch' ? lease.promise : undefined),
    })
    const source = new NodeRepositorySource(f.client, identity, {
      node: 'Sample node',
      project: 'Sample project',
    })
    const events = vi.fn()
    source.subscribe(events)
    const watching = source.startWatching()
    await settle()
    // The lease says revision 0; batch 1 overtakes its answer.
    f.batch(1, { complete: true, entries: [{ change: 'added', entry: file('one.ts') }], git: null })
    lease.release()
    await watching
    events.mockClear()
    f.batch(2, { complete: true, entries: [{ change: 'added', entry: file('two.ts') }], git: null })
    expect(events.mock.calls).toEqual([[{ kind: 'tree', paths: ['two.ts'] }]])
    source.dispose()
  })
  it('follows the batches still on their way when its lease is renewed', async () => {
    const { source, events, batch } = await start()
    const tree = await source.tree(WORKING_TREE)
    batch(1, { complete: true, entries: [{ change: 'added', entry: file('one.ts') }], git: null })
    const deliver = batch(
      2,
      { complete: true, entries: [{ change: 'added', entry: file('two.ts') }], git: null },
      true
    )
    events.mockClear()
    await (source as unknown as { renewWatch(): Promise<void> }).renewWatch()
    deliver()
    expect(tree.root.children!.map((c) => c.path)).toEqual([
      'app.ts',
      'one.ts',
      'README.md',
      'two.ts',
    ])
    expect(events.mock.calls).toEqual([[{ kind: 'tree', paths: ['two.ts'] }]])
    source.dispose()
  })
  it('adds to a tree the batches that arrived while it was being read', async () => {
    let read: ReturnType<typeof later> | undefined
    const f = nodeRepositoryFixture({
      changes: true,
      hold: (method) => (method === 'repository.v1.tree' ? read?.promise : undefined),
    })
    const source = new NodeRepositorySource(f.client, identity, {
      node: 'Sample node',
      project: 'Sample project',
    })
    await source.startWatching()
    read = later()
    const reading = source.tree(WORKING_TREE)
    await settle()
    // The listing was taken before this batch; the batch reaches the client before the listing.
    f.batch(1, { complete: true, entries: [{ change: 'added', entry: file('new.ts') }], git: null })
    read.release()
    const tree = await reading
    expect(tree.live).toBe(true)
    expect(tree.root.children!.map((c) => c.path)).toEqual(['app.ts', 'new.ts', 'README.md'])
    source.dispose()
  })
  it('stops patching the trees it handed out once it has to reread everything', async () => {
    const { source, batch } = await start()
    const tree = await source.tree(WORKING_TREE)
    expect(tree.live).toBe(true)
    batch(1, { complete: false, reason: 'overflow' })
    // The tab reads that tree again; the new one follows the stream from here.
    expect(tree.live).toBe(false)
    const next = await source.tree(WORKING_TREE)
    expect(next.live).toBe(true)
    batch(2, { complete: true, entries: [{ change: 'added', entry: file('new.ts') }], git: null })
    expect(next.root.children!.some((c) => c.path === 'new.ts')).toBe(true)
    expect(tree.root.children!.some((c) => c.path === 'new.ts')).toBe(false)
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
