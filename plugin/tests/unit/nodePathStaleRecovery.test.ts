import { expect, it, vi } from 'vitest'
import { ChannelError } from '@abele/channel-protocol'
import { MemoryClientStore } from '@abele/node-client'
import { NodePathMutations } from '@/node/NodePathMutations'
import { NodePathModel, pathTargetKey, type NodePathPort } from '@/node/NodePathModel'
import { NodePathClientPort } from '@/node/NodePathClientPort'
import { nodeErrorWords } from '@/node/errorWords'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'
import { nodeRepositoryFixture, identity } from '../helpers/nodeRepositoryFixture'

const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-tree',
}
function fixture() {
  const stop = vi.fn()
  const port = {
    catalogue: vi.fn(async () => ({
      folders: [],
      targets: [target],
      sessions: [],
      capabilities: [],
    })),
    inspect: vi.fn(async (_target: unknown, _files?: boolean, _revision?: unknown) => ({
      entries: [],
      changes: [],
    })),
    watch: vi.fn(async () => stop),
    invalidate: vi.fn(),
  }
  const model = new NodePathModel(
    target.nodeId,
    target.registrationId,
    port as unknown as NodePathPort,
    new Map()
  )
  model.targets.value = [target]
  return { model, port, stop }
}
it('retires a definitive stale mkdir intent but preserves unknown operations and original params', async () => {
  const mkdir = vi
    .fn()
    .mockRejectedValueOnce(new ChannelError('stale_resource'))
    .mockResolvedValueOnce({ path: '/sample/new' })
  const client = { store: new MemoryClientStore(), nodePath: { mkdir } }
  await expect(
    new NodePathMutations(client as never).mkdir('old-id', 'new', '/sample')
  ).rejects.toThrow('stale_resource')
  await new NodePathMutations(client as never).mkdir('fresh-id', 'new', '/sample')
  expect(mkdir.mock.calls[1][0].directory_id).toBe('fresh-id')
  expect(mkdir.mock.calls[1][1]).not.toBe(mkdir.mock.calls[0][1])
  mkdir
    .mockRejectedValueOnce(new ChannelError('outcome_unknown'))
    .mockResolvedValueOnce({ path: '/sample/other' })
  await expect(
    new NodePathMutations(client as never).mkdir('first-id', 'other', '/sample')
  ).rejects.toThrow('outcome_unknown')
  await new NodePathMutations(client as never).mkdir('second-id', 'other', '/sample')
  expect(mkdir.mock.calls[3]).toEqual(mkdir.mock.calls[2])
})
it('retains the created path after registration fails so reopening never repeats mkdir', async () => {
  const factory = new IDBFactory()
  const mkdir = vi.fn(async () => ({ path: '/sample/new' }))
  const register = vi
    .fn()
    .mockRejectedValueOnce(new ChannelError('disconnected'))
    .mockResolvedValueOnce({ project_id: 'sample-project' })
  const client = {
    store: new NodeClientStore('sample-created-intent', factory),
    nodePath: { mkdir, register },
  }
  const first = new NodePathMutations(client as never)
  await first.mkdir('old-id', 'new', '/sample')
  await expect(first.register('/sample/new')).rejects.toThrow('disconnected')
  client.store.close()
  const reopenedStore = new NodeClientStore('sample-created-intent', factory)
  const reopened = new NodePathMutations({ ...client, store: reopenedStore } as never)
  expect(await reopened.mkdir('fresh-id', 'new', '/sample')).toBe('/sample/new')
  await reopened.register('/sample/new')
  expect(mkdir).toHaveBeenCalledOnce()
  expect(register.mock.calls[1][1]).toBe(register.mock.calls[0][1])
  reopenedStore.close()
})
it('refreshes an inactive target once, discards observation and pagination, and restores its watch', async () => {
  const { model, port, stop } = fixture()
  await model.selectTarget(target)
  model.cursors.value = { [pathTargetKey(target)]: { '': 'old-cursor' } }
  port.inspect.mockRejectedValueOnce(new ChannelError('stale_resource'))
  await model.reloadTarget(target)
  expect(port.catalogue).toHaveBeenCalledOnce()
  expect(port.inspect).toHaveBeenCalledTimes(3)
  expect(port.inspect.mock.calls.at(-1)?.[2]).toBeUndefined()
  expect(model.cursors.value[pathTargetKey(target)]).toBeUndefined()
  expect(stop).toHaveBeenCalledOnce()
  expect(port.watch).toHaveBeenCalledTimes(2)
})
it('does not retry or transfer selection when the catalogue replaces the target ID', async () => {
  const { model, port } = fixture()
  await model.selectTarget(target)
  port.catalogue.mockResolvedValueOnce({
    folders: [],
    targets: [{ ...target, id: 'replacement-tree' }],
    sessions: [],
    capabilities: [],
  })
  port.inspect.mockRejectedValueOnce(new ChannelError('stale_resource'))
  await expect(model.reloadTarget(target)).rejects.toThrow('stale_resource')
  expect(port.inspect).toHaveBeenCalledTimes(2)
  expect(model.current.value).toBeUndefined()
  expect(model.inspections.value[pathTargetKey(target)]).toBeUndefined()
  expect(model.selected.value).not.toBe('replacement-tree')
})
it('bounds recovery when the same target stays stale', async () => {
  const { model, port } = fixture()
  port.inspect.mockRejectedValue(new ChannelError('stale_resource'))
  await expect(model.reloadTarget(target)).rejects.toThrow('stale_resource')
  expect(port.inspect).toHaveBeenCalledTimes(2)
  expect(port.catalogue).toHaveBeenCalledOnce()
})
it('reconnects by dropping observations and watches before reading the confirmed target', async () => {
  const { model, port, stop } = fixture()
  await model.selectTarget(target)
  model.cursors.value = { [pathTargetKey(target)]: { '': 'old-page' } }
  await model.reconnected()
  expect(stop).toHaveBeenCalledOnce()
  expect(port.invalidate).toHaveBeenCalled()
  expect(port.watch).toHaveBeenCalledTimes(2)
  expect(model.cursors.value[pathTargetKey(target)]).toBeUndefined()
})
it('leaves stale session bindings unresolved without dropping the rest of the catalogue', async () => {
  const f = nodeRepositoryFixture()
  const session = {
    session_id: 'sample-chat',
    title: 'Sample chat',
    provider: 'fake',
    workspace_id: null,
    created_at: '2025-01-01T00:00:00Z',
  }
  const client = {
    ...f.client,
    describe: async () => ({
      capabilities: { capabilities: { node_path_execution: { status: 'supported' } } },
    }),
    listProjects: async () => [],
    listSessions: async (after?: string) => (after ? [] : [session]),
    nodePath: { sessionWorktreeGet: vi.fn().mockRejectedValue(new ChannelError('stale_resource')) },
    store: new MemoryClientStore(),
    subscribe: vi.fn(),
  }
  const port = new NodePathClientPort(client as never, {
    nodeId: identity.node,
    registrationId: identity.installation,
  })
  const catalogue = await port.catalogue()
  expect(catalogue.sessions).toHaveLength(1)
  expect(catalogue.sessions[0].target).toBeUndefined()
})
it('explains a stale resource as recoverable reselection', () => {
  expect(nodeErrorWords('stale_resource')).toContain('choose')
})
it('restarts stale pagination at a new observation rather than reusing the cursor', async () => {
  const { model, port } = fixture()
  const tree = vi.fn(
    async (_target: unknown, _path: string, _cursor?: string, _revision?: unknown) => ({
      entries: [],
      cursor: 'next-page' as string | null,
      revision: { kind: 'commit' as const, commit: 'a'.repeat(40) },
    })
  )
  Object.assign(port, { tree })
  await model.selectTarget(target)
  tree.mockRejectedValueOnce(new ChannelError('stale_resource'))
  await model.loadMore()
  expect(port.catalogue).toHaveBeenCalledOnce()
  expect(tree.mock.calls.at(-1)?.slice(1)).toEqual(['', undefined, undefined])
})
it('gets a new observation once after stale_revision without refreshing bindings', async () => {
  const { model, port } = fixture()
  await model.selectTarget(target)
  port.inspect.mockRejectedValueOnce(new ChannelError('stale_revision'))
  await model.reloadTarget(target, false)
  expect(port.inspect).toHaveBeenCalledTimes(3)
  expect(port.inspect.mock.calls.at(-1)?.[2]).toBeUndefined()
  expect(port.catalogue).not.toHaveBeenCalled()
})
it('recovers a stale initial watch before treating selection as ready', async () => {
  const { model, port } = fixture()
  port.watch.mockRejectedValueOnce(new ChannelError('stale_resource'))
  await model.selectTarget(target)
  expect(port.catalogue).toHaveBeenCalledOnce()
  expect(port.watch).toHaveBeenCalledTimes(2)
  expect(model.current.value).toEqual(target)
})
it('stops the old watch when an ordinary catalogue refresh removes its target', async () => {
  const { model, port, stop } = fixture()
  await model.selectTarget(target)
  port.catalogue.mockResolvedValueOnce({ folders: [], targets: [], sessions: [], capabilities: [] })
  await model.refresh()
  expect(stop).toHaveBeenCalledOnce()
  expect(model.inspections.value[pathTargetKey(target)]).toBeUndefined()
  expect(model.error.value).not.toBe('')
})
it('does not publish an old tree page that finishes after reconnect invalidated it', async () => {
  const { model, port } = fixture()
  type Page = { entries: { name: string; path: string; kind: 'file' }[]; cursor: null }
  let finish!: (page: Page) => void
  const tree = vi.fn(async (): Promise<Page> => ({ entries: [], cursor: null }))
  tree.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  Object.assign(port, { tree })
  const selecting = model.selectTarget(target)
  for (let i = 0; i < 10 && !finish; i++) await Promise.resolve()
  const reconnecting = model.reconnected()
  finish({ entries: [{ name: 'old.txt', path: 'old.txt', kind: 'file' }], cursor: null })
  await selecting
  await reconnecting
  expect(model.entries.value).toEqual([])
  expect(tree).toHaveBeenCalledTimes(2)
})
it('requires reselection when a plain folder keeps its project but changes workspace identity', async () => {
  const { model, port } = fixture()
  const plain = { ...target, kind: 'workspace' as const, id: 'sample-workspace' }
  model.targets.value = [plain]
  await model.selectTarget(plain)
  port.catalogue.mockResolvedValueOnce({
    folders: [],
    targets: [{ ...plain, id: 'replacement-workspace' }],
    sessions: [],
    capabilities: [],
  } as never)
  await model.refresh()
  expect(model.current.value).toBeUndefined()
  expect(model.error.value).not.toBe('')
})
