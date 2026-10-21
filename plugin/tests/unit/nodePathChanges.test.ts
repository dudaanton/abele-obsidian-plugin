import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryClientStore, NodePathClient } from '@abele/node-client'
import { ChannelError } from '@abele/channel-protocol'
import { applyPathChanges, type PathTreeBatch } from '@/node/nodePathChanges'
import { NodePathClientPort } from '@/node/NodePathClientPort'
import {
  NodePathModel,
  NodePathFileModel,
  type NodePathPort,
  type PathTarget,
} from '@/node/NodePathModel'
import type { TreeEntry } from '@/components/nodeWork/types'
import { nodeRepositoryFixture, identity } from '../helpers/nodeRepositoryFixture'

const file = (path: string) => ({
  path,
  name: path.split('/').at(-1)!,
  kind: 'file' as const,
  oid: null,
  size: 1,
})
const directory = (path: string) => ({
  path,
  name: path.split('/').at(-1)!,
  kind: 'directory' as const,
  oid: null,
  size: null,
})
const row = (path: string, children?: TreeEntry[]): TreeEntry => ({
  path,
  name: path.split('/').at(-1)!,
  kind: children ? 'folder' : 'file',
  ...(children ? { children } : {}),
})

describe('applying a node change batch to the path sidebar', () => {
  // In the node's listing order.
  const sample = () => [
    row('docs', undefined),
    row('README.md'),
    row('src', [row('src/a.ts'), row('src/inner', [row('src/inner/deep.ts')])]),
  ]
  it('keeps the rows a batch does not name and fills only folders already read', () => {
    const entries = sample()
    entries[0] = { ...entries[0], kind: 'folder' }
    const next = applyPathChanges(entries, [
      { change: 'added', entry: file('src/b.ts') },
      { change: 'added', entry: file('docs/guide.md') },
      { change: 'modified', entry: file('README.md') },
      { change: 'added', entry: { ...file('link'), kind: 'symlink' } },
    ])
    expect(next[0]).toBe(entries[0])
    expect(next[1]).toBe(entries[1])
    expect(next[2]!.children![2]).toBe(entries[2]!.children![1])
    expect(next[2]!.children!.map((c) => c.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/inner'])
    expect(next.map((c) => c.path)).toEqual(['docs', 'README.md', 'src'])
    expect(next[0]!.children).toBeUndefined()
  })
  it('moves a renamed folder with what was read in it and removes deleted rows', () => {
    const next = applyPathChanges(sample(), [
      { change: 'renamed', from: 'src/inner', entry: directory('lib') },
      { change: 'deleted', path: 'src/a.ts', kind: 'file' },
    ])
    expect(next.map((c) => c.path)).toEqual(['docs', 'lib', 'README.md', 'src'])
    expect(next[1]!.children).toEqual([row('lib/deep.ts')])
    expect(next[3]!.children).toEqual([])
  })
  it('places a row of a plain folder in the order that folder is listed in', () => {
    const plain = [row('B.md'), row('c.md')]
    const next = applyPathChanges(plain, [{ change: 'added', entry: file('a.md') }], 'plain')
    expect(next.map((c) => c.path)).toEqual(['B.md', 'a.md', 'c.md'])
    expect(
      applyPathChanges([row('a.md'), row('c.md')], [{ change: 'added', entry: file('B.md') }]).map(
        (c) => c.path
      )
    ).toEqual(['a.md', 'B.md', 'c.md'])
  })
  it('changes nothing when the listing already shows the batch', () => {
    const batch = [
      { change: 'added' as const, entry: file('src/b.ts') },
      { change: 'renamed' as const, from: 'src/a.ts', entry: file('src/c.ts') },
      { change: 'deleted' as const, path: 'docs', kind: 'directory' as const },
    ]
    const once = applyPathChanges(sample(), batch)
    expect(applyPathChanges(once, batch)).toBe(once)
  })
})

describe('the path sidebar port on the change stream', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  const start = async (changes = true) => {
    const f = nodeRepositoryFixture({ changes })
    const client = {
      ...f.client,
      store: new MemoryClientStore(),
      describe: vi.fn(async () =>
        changes
          ? {
              capabilities: {
                capabilities: {
                  repository_changes_v1: { status: 'supported' },
                  workspace_changes_v1: { status: 'supported' },
                  node_path_v2: { status: 'supported' },
                },
              },
            }
          : {}
      ),
      nodePath: new NodePathClient(f.request, async () => {
        throw new Error('No mutation in this read fixture')
      }),
      listProjects: vi.fn(async () => []),
      listSessions: vi.fn(async () => []),
      listWorkspaces: vi.fn(async () => []),
      listFiles: vi.fn(),
      readFile: vi.fn(),
      readContent: vi.fn(),
    }
    const port = new NodePathClientPort(client as any, {
      nodeId: identity.node,
      registrationId: identity.installation,
    })
    await port.catalogue()
    const target: PathTarget = {
      nodeId: identity.node,
      registrationId: identity.installation,
      projectId: identity.project,
      kind: 'worktree',
      id: identity.workspace,
    }
    const notify = vi.fn(),
      changed = vi.fn<(batch: PathTreeBatch) => void>()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stop = await port.watch(target, notify, changed)
    return { ...f, port, target, notify, changed, stop }
  }
  it('hands in-order batches over and rereads only after a gap or an incomplete batch', async () => {
    const { batch, calls, notify, changed, event, stop } = await start()
    expect(calls.find((c) => c.method === 'repository.v1.watch')!.params).toEqual({
      worktree_id: identity.workspace,
      changes: null,
    })
    // The first lease starts the stream; the caller reads the files after it, once.
    expect(notify).not.toHaveBeenCalled()
    batch(1, { complete: true, entries: [{ change: 'added', entry: file('a.ts') }], git: null })
    expect(changed.mock.calls).toEqual([
      [{ entries: [{ change: 'added', entry: file('a.ts') }], git: false }],
    ])
    // The plain hint that something changed is not needed beside the batches.
    event('repository.invalidated', { worktree_id: identity.workspace, reason: 'filesystem' })
    expect(notify).not.toHaveBeenCalled()
    batch(3, { complete: true, entries: [{ change: 'added', entry: file('b.ts') }], git: null })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)
    batch(4, { complete: false, reason: 'overflow' })
    expect(notify).toHaveBeenCalledTimes(2)
    batch(5, {
      complete: true,
      entries: [],
      git: { head: null, branch: 'refs/heads/main', detached: false, status: [] },
    })
    expect(changed.mock.calls.at(-1)).toEqual([{ entries: [], git: true }])
    stop()
  })
  it('rereads when a same-target batch cannot be decoded instead of losing its invalidation', async () => {
    const { notify, changed, event, stop } = await start()
    const invalid = {
      worktree_id: identity.workspace,
      stream_id: 'stream-fixture',
      revision: 1,
      complete: true,
      entries: [{ change: 'unknown' }],
      git: null,
    }
    event('repository.changed', { ...invalid, worktree_id: 'another-worktree' })
    expect(notify).not.toHaveBeenCalled()
    event('repository.changed', invalid)
    expect(notify).toHaveBeenCalledOnce()
    expect(changed).not.toHaveBeenCalled()
    stop()
  })
  it('renews its lease without reading the files again', async () => {
    const { batch, calls, notify, stop } = await start()
    batch(1, { complete: true, entries: [], git: null })
    notify.mockClear()
    await vi.advanceTimersByTimeAsync(45000)
    expect(calls.filter((c) => c.method === 'repository.v1.watch').at(-1)!.params.changes).toEqual({
      stream_id: 'stream-fixture',
      revision: 1,
    })
    expect(notify).not.toHaveBeenCalled()
    stop()
  })
  it('reads the folder list again for a batch only when git state moved', async () => {
    const { port, batch, stop } = await start()
    const catalogue = vi.fn()
    const unsubscribe = await port.subscribe(catalogue)
    batch(1, { complete: true, entries: [{ change: 'added', entry: file('a.ts') }], git: null })
    expect(catalogue).not.toHaveBeenCalled()
    batch(2, {
      complete: true,
      entries: [],
      git: { head: null, branch: 'refs/heads/other', detached: false, status: [] },
    })
    expect(catalogue).toHaveBeenCalledTimes(1)
    unsubscribe()
    stop()
  })
  it('keeps diagnostic pushes out of catalogue refreshes so opening a file cannot reopen it in a loop', async () => {
    const { port, event, stop } = await start()
    const catalogue = vi.fn()
    const unsubscribe = await port.subscribe(catalogue)
    event('lsp.diagnostics', {
      worktree_id: identity.workspace,
      path: 'sample.ts',
      diagnostics: [],
    })
    event('lsp.status', { workspace_id: identity.workspace, message: 'Sample server stopped' })
    expect(catalogue).not.toHaveBeenCalled()
    event('project.trust.changed', { project_id: identity.project, trust: 'trusted' })
    expect(catalogue).toHaveBeenCalledOnce()
    unsubscribe()
    stop()
  })
  it('follows a plain folder on its own stream', async () => {
    const { port, folderBatch, calls, stop } = await start()
    stop()
    const folder: PathTarget = {
      nodeId: identity.node,
      registrationId: identity.installation,
      projectId: identity.project,
      kind: 'workspace',
      id: 'workspace-plain',
    }
    const notify = vi.fn(),
      changed = vi.fn<(batch: PathTreeBatch) => void>()
    const stopFolder = await port.watch(folder, notify, changed)
    expect(calls.filter((c) => c.method === 'workspace.watch').at(-1)!.params).toEqual({
      workspace_id: 'workspace-plain',
      changes: null,
    })
    notify.mockClear()
    folderBatch('workspace-other', 1, { complete: true, entries: [] })
    folderBatch('workspace-plain', 1, {
      complete: true,
      entries: [{ change: 'added', entry: file('a.ts') }],
    })
    expect(changed.mock.calls).toEqual([
      [{ entries: [{ change: 'added', entry: file('a.ts') }], git: false }],
    ])
    expect(notify).not.toHaveBeenCalled()
    stopFolder()
  })
  it('keeps the legacy lease and its rereads on a node without the stream', async () => {
    const { calls, notify, changed, stop } = await start(false)
    expect(calls.find((c) => c.method === 'repository.v1.watch')!.params).toEqual({
      worktree_id: identity.workspace,
    })
    await vi.advanceTimersByTimeAsync(45000)
    expect(notify).toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    stop()
  })
})

describe('the path sidebar model on the change stream', () => {
  const target: PathTarget = {
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    projectId: 'sample-project',
    kind: 'worktree',
    id: 'sample-target',
  }
  const revision = {
    kind: 'working' as const,
    observation_id: 'sample-observation',
    head: 'a'.repeat(40),
    observed_at: '2025-01-01T00:00:00Z',
  }
  const ticks = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve()
  }
  const open = async () => {
    let changed!: (batch: PathTreeBatch) => void
    const folder = { path: 'src', name: 'src', kind: 'folder' as const }
    const port = {
      catalogue: vi.fn(async () => ({
        folders: [],
        targets: [target],
        sessions: [],
        capabilities: [],
      })),
      tree: vi.fn(async (_target: PathTarget, path: string) => ({
        entries: path === 'src' ? [row('src/a.ts')] : [folder, row('README.md')],
        cursor: null,
        revision,
      })),
      inspect: vi.fn(async () => ({ entries: [], changes: [], revision })),
      file: vi.fn(),
      history: vi.fn(),
      commit: vi.fn(),
      subscribe: vi.fn(async () => () => {}),
      watch: vi.fn(
        async (_target: PathTarget, _notify: () => void, apply?: (b: PathTreeBatch) => void) => {
          let stopped = false
          changed = (batch) => {
            if (!stopped) apply!(batch)
          }
          return () => {
            stopped = true
          }
        }
      ),
    }
    const model = new NodePathModel(
      target.nodeId,
      target.registrationId,
      port as unknown as NodePathPort,
      { get: () => undefined, set: () => {} }
    )
    await model.refresh()
    await model.select(target.id)
    await model.loadFolder('src')
    port.tree.mockClear()
    port.inspect.mockClear()
    return { model, port, changed }
  }
  it('keeps an open file current after the sidebar switches to another worktree, sharing its watch', async () => {
    const { model, port, changed } = await open()
    const other = { ...target, id: 'sample-other' }
    port.catalogue.mockResolvedValue({
      folders: [],
      targets: [target, other],
      sessions: [],
      capabilities: [],
    })
    await model.refresh()
    let text = 'before'
    port.file.mockImplementation(async () => ({
      target,
      path: 'README.md',
      text,
      contentId: text,
      revision,
    }))
    const tab = new NodePathFileModel(model, target)
    await tab.open('README.md')
    expect(port.watch).toHaveBeenCalledTimes(1)
    await model.select(other.id)
    text = 'after'
    changed({ entries: [{ change: 'modified', entry: file('README.md') }], git: false })
    await ticks()
    expect(tab.document.value?.text).toBe('after')
    port.tree.mockRejectedValueOnce(new ChannelError('stale_revision'))
    await model.reloadTarget(target)
    await ticks()
    expect(port.watch).toHaveBeenCalledTimes(3)
    tab.destroy()
    model.destroy()
  })
  it('invalidates open tabs after streamed file edits without rereading the tree', async () => {
    const { model, port, changed } = await open()
    const before = { ...model.fileRefresh.value }
    changed({ entries: [{ change: 'modified', entry: file('README.md') }], git: false })
    await ticks()
    expect(model.fileRefresh.value).not.toEqual(before)
    expect(port.tree).not.toHaveBeenCalled()
    model.destroy()
  })
  it('does not reread file contents for a git-only observation that can be caused by reading a file', async () => {
    const { model, changed } = await open()
    const before = { ...model.fileRefresh.value }
    changed({ entries: [], git: true })
    await ticks()
    expect(model.fileRefresh.value).toEqual(before)
    model.destroy()
  })
  it('starts the watch before reading the files, and reads them once', async () => {
    const order: string[] = []
    const port = {
      catalogue: vi.fn(async () => ({
        folders: [],
        targets: [target],
        sessions: [],
        capabilities: [],
      })),
      tree: vi.fn(async () => {
        order.push('tree')
        return { entries: [row('README.md')], cursor: null, revision }
      }),
      inspect: vi.fn(async () => ({ entries: [], changes: [], revision })),
      file: vi.fn(),
      history: vi.fn(),
      commit: vi.fn(),
      subscribe: vi.fn(async () => () => {}),
      watch: vi.fn(async () => {
        order.push('watch')
        return () => {}
      }),
    }
    const model = new NodePathModel(
      target.nodeId,
      target.registrationId,
      port as unknown as NodePathPort,
      { get: () => undefined, set: () => {} }
    )
    await model.refresh()
    await model.select(target.id)
    await ticks()
    expect(order).toEqual(['watch', 'tree'])
    model.destroy()
  })
  it('patches an opened folder in place without reading the tree again', async () => {
    const { model, port, changed } = await open()
    const readme = model.entries.value[1]
    changed({ entries: [{ change: 'added', entry: file('src/b.ts') }], git: false })
    await ticks()
    expect(model.entries.value[0]!.children!.map((c) => c.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(model.entries.value[1]).toEqual(readme)
    expect(port.tree).not.toHaveBeenCalled()
    expect(port.inspect).not.toHaveBeenCalled()
    model.destroy()
  })
  it('reads the change list again, not the tree, when git state moves', async () => {
    const { model, port, changed } = await open()
    changed({ entries: [], git: true })
    await ticks()
    expect(port.tree).not.toHaveBeenCalled()
    expect(port.inspect).toHaveBeenCalledTimes(1)
    expect(port.inspect.mock.calls[0]![1]).toBe(false)
    model.destroy()
  })
  it('gives a folder read the batches that overtook it', async () => {
    const { model, port, changed } = await open()
    let finish!: () => void
    port.tree.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (finish = resolve))
      return { entries: [row('docs/old.md')], cursor: null, revision }
    })
    changed({ entries: [{ change: 'added', entry: directory('docs') }], git: false })
    await ticks()
    const reading = model.loadFolder('docs')
    await ticks()
    changed({ entries: [{ change: 'added', entry: file('docs/new.md') }], git: false })
    finish()
    await reading
    const docs = model.entries.value.find((e) => e.path === 'docs')!
    expect(docs.children!.map((c) => c.path)).toEqual(['docs/new.md', 'docs/old.md'])
    model.destroy()
  })
})
