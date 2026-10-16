import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { validateParams } from '@abele/node-protocol'
import type { NodeConnection } from '@/node/NodeService'
import type { NodeFilesModel } from '@/node/NodeFilesModel'
import { deferred } from '../helpers/deferred'
const shown = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'tree-one',
}
const reference = {
  kind: 'node-session' as const,
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  sessionId: 'sample-session',
  title: 'Sample session',
}
afterEach(() => vi.restoreAllMocks())
async function setup() {
  const store = new MemoryClientStore()
  await store.transaction((s) => {
    s.node_id = reference.nodeId
  })
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    store
  )
  vi.spyOn(client, 'subscribe').mockResolvedValue(undefined)
  const connection = { client, state: ref('offline') } as unknown as NodeConnection
  const presenter = new NodeChatPresenter(reference, connection)
  return { client, store, presenter, connection }
}
it('retains an offline turn as a local draft without any outbox admission', async () => {
  const { presenter, store } = await setup()
  await presenter.send('Sample offline turn')
  expect(await store.transaction((s) => s.outbox)).toEqual([])
  expect(presenter.draft.value.text).toBe('Sample offline turn')
  presenter.destroy()
})
it('reads the real daemon description and carries its binding into a submitted turn', async () => {
  const { presenter, client, store, connection } = await setup()
  connection.state.value = 'connected'
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  presenter.nodeDescription.value = { node_version: '0.4.18' }
  const binding = {
    project_id: shown.projectId,
    target: { kind: 'worktree' as const, worktree_id: shown.id },
    incarnation: 'sample-binding',
  }
  const read = vi.spyOn(client.nodePath, 'sessionWorktreeGet').mockResolvedValue(binding)
  vi.spyOn(client, 'flush').mockResolvedValue(undefined)
  try {
    await presenter.refreshBinding()
    expect(read).toHaveBeenCalledWith({
      session_id: reference.sessionId,
      include_incarnation: true,
    })
    expect(presenter.binding.value).toEqual(binding)
    await presenter.send('Sample guarded turn')
    const outbox = await store.transaction((s) => s.outbox)
    expect(outbox).toHaveLength(1)
    expect(outbox[0].params).toHaveProperty('expected_target', {
      target: binding.target,
      incarnation: binding.incarnation,
    })
  } finally {
    presenter.destroy()
  }
})
it('rejects a turn when the node session has moved away from the displayed worktree', async () => {
  const { presenter, client, store, connection } = await setup()
  connection.state.value = 'connected'
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  vi.spyOn(client.nodePath, 'sessionWorktreeGet').mockResolvedValue({
    project_id: shown.projectId,
    target: { kind: 'worktree', worktree_id: 'tree-two' },
  })
  await presenter.send('Sample bound turn', undefined, shown)
  expect(await store.transaction((s) => s.outbox)).toEqual([])
  expect(presenter.draft.value.text).toBe('Sample bound turn')
  expect(presenter.error.value).toContain('worktree')
  presenter.destroy()
})
it('carries the displayed target and incarnation as an atomic node-side turn precondition', () => {
  expect(
    validateParams('session.send', {
      session_id: reference.sessionId,
      text: 'Sample atomic turn',
      observed_seq: 3,
      expected_target: {
        target: { kind: 'worktree', worktree_id: shown.id },
        incarnation: 'sample-incarnation',
      },
    })
  ).toHaveProperty('expected_target', {
    target: { kind: 'worktree', worktree_id: shown.id },
    incarnation: 'sample-incarnation',
  })
})
it('rejects a disconnect that occurs while preparing a connected turn', async () => {
  const { presenter, client, store, connection } = await setup()
  connection.state.value = 'connected'
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  vi.spyOn(client, 'cursor').mockImplementation(async () => {
    connection.state.value = 'offline'
    return 3
  })
  await presenter.send('Sample racing turn')
  expect(await store.transaction((s) => s.outbox)).toEqual([])
  expect(presenter.draft.value.text).toBe('Sample racing turn')
  presenter.destroy()
})

it('does not restore an admitted draft when the chat closes while confirmation is pending', async () => {
  const { presenter, client, store, connection } = await setup()
  connection.state.value = 'connected'
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  let release!: () => void
  const flushing = vi.spyOn(client, 'flush').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  presenter.draft.value.text = 'Sample admitted turn'
  const sending = presenter.send('Sample admitted turn')
  await vi.waitFor(() => expect(flushing).toHaveBeenCalledOnce())
  presenter.destroy()
  const reopened = new NodeChatPresenter(reference, connection)
  await reopened.refresh()
  expect(reopened.draft.value.text).toBe('')
  release()
  await sending
  expect(await store.transaction((s) => s.outbox)).toHaveLength(1)
  reopened.destroy()
})

it('persists a refused turn even if its composer closes before the receipt arrives', async () => {
  const { presenter, client, connection } = await setup()
  connection.state.value = 'connected'
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  let release!: () => void
  const flushing = vi.spyOn(client, 'flush').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  vi.spyOn(client, 'operationResult').mockResolvedValue({ error: 'not_found' })
  presenter.draft.value.text = 'Sample refused turn'
  const sending = presenter.send('Sample refused turn')
  await vi.waitFor(() => expect(flushing).toHaveBeenCalledOnce())
  presenter.destroy()
  release()
  await sending
  const reopened = new NodeChatPresenter(reference, connection)
  await reopened.refresh()
  expect(reopened.draft.value.text).toBe('Sample refused turn')
  reopened.destroy()
})

it('keeps the composer draft when the node returns a typed target refusal', async () => {
  const { presenter, client, connection } = await setup()
  connection.state.value = 'connected'
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  vi.spyOn(client, 'flush').mockResolvedValue(undefined)
  vi.spyOn(client, 'operationResult').mockResolvedValue({
    result: { code: 'target_changed', current_target: null },
  })
  presenter.draft.value.text = 'Sample target-bound draft'
  try {
    await presenter.send('Sample target-bound draft')
    expect(presenter.draft.value.text).toBe('Sample target-bound draft')
    expect(presenter.draftNotice.value).toContain('Nothing was sent')
  } finally {
    presenter.destroy()
  }
})
it.each([true, false])(
  'pins the displayed incarnation only on supported nodes (supported: %s)',
  async (supported) => {
    const { presenter, client, store, connection } = await setup()
    connection.state.value = 'connected'
    vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
    presenter.nodeDescription.value = { version: supported ? '0.4.2' : '0.4.1' }
    const read = vi.spyOn(client.nodePath, 'sessionWorktreeGet').mockResolvedValue({
      project_id: shown.projectId,
      target: { kind: 'worktree', worktree_id: shown.id },
    })
    vi.spyOn(client, 'flush').mockResolvedValue(undefined)
    await presenter.send('Sample pinned draft', undefined, {
      ...shown,
      incarnation: 'sample-old-binding',
    })
    const request = await store.transaction((s) => s.outbox[0]?.params)
    if (supported) {
      expect(request).toHaveProperty('expected_target', {
        target: { kind: 'worktree', worktree_id: shown.id },
        incarnation: 'sample-old-binding',
      })
      expect(read).not.toHaveBeenCalled()
    } else {
      expect(request).not.toHaveProperty('expected_target')
      expect(read).toHaveBeenCalledWith({ session_id: reference.sessionId })
    }
    presenter.destroy()
  }
)
it('refreshes the real binding on refusal but never automatically resends the retained draft', async () => {
  const { presenter, client, connection } = await setup()
  connection.state.value = 'connected'
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  presenter.nodeDescription.value = { version: '0.4.2' }
  const actual = {
    project_id: shown.projectId,
    target: { kind: 'worktree' as const, worktree_id: 'tree-two' },
    incarnation: 'sample-new-binding',
  }
  const read = vi.spyOn(client.nodePath, 'sessionWorktreeGet').mockResolvedValue(actual)
  const flush = vi.spyOn(client, 'flush').mockResolvedValue(undefined)
  vi.spyOn(client, 'operationResult').mockResolvedValue({
    result: {
      code: 'target_changed',
      current_target: { target: actual.target, incarnation: actual.incarnation },
    },
  })
  await presenter.send('Sample pinned draft', undefined, {
    ...shown,
    incarnation: 'sample-old-binding',
  })
  expect(presenter.binding.value).toEqual(actual)
  expect(read).toHaveBeenCalledWith({ session_id: reference.sessionId, include_incarnation: true })
  expect(presenter.draft.value.text).toBe('Sample pinned draft')
  expect(presenter.draftNotice.value).toContain('chat moved')
  await presenter.refresh()
  expect(flush).toHaveBeenCalledOnce()
  presenter.destroy()
})
it('waits for an in-flight description without replacing the target captured at the Send click', async () => {
  const { presenter, client, store, connection } = await setup()
  const description = deferred<unknown>()
  const describe = vi.spyOn(client, 'describe').mockImplementation(() => description.promise)
  connection.connect = vi.fn(async () => {})
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  vi.spyOn(client, 'flush').mockResolvedValue(undefined)
  vi.spyOn(client.nodePath, 'sessionWorktreeGet').mockResolvedValue({
    project_id: shown.projectId,
    target: { kind: 'worktree', worktree_id: shown.id },
    incarnation: 'sample-new-binding',
  })
  const loading = presenter.load()
  connection.state.value = 'connected'
  const sending = presenter.send('Sample loading draft', undefined, {
    ...shown,
    incarnation: 'sample-click-binding',
  })
  try {
    await vi.waitFor(() => expect(describe).toHaveBeenCalled())
    expect(await store.transaction((s) => s.outbox)).toEqual([])
  } finally {
    description.resolve({ version: '0.4.2' })
    await Promise.all([loading, sending])
  }
  expect(presenter.error.value).toBe('')
  expect(await store.transaction((s) => s.outbox[0]?.params)).toHaveProperty(
    'expected_target.incarnation',
    'sample-click-binding'
  )
  presenter.destroy()
})
it('keeps retained review comments pinned but opens a fresh review binding after they are removed', async () => {
  const { presenter } = await setup()
  presenter.nodeDescription.value = { version: '0.4.2' }
  presenter.projection.value.session = {
    session_id: reference.sessionId,
    title: 'Sample chat',
    provider: 'fake',
    created_at: '2025-01-01T00:00:00Z',
    workspace_id: 'sample-workspace',
  }
  presenter.binding.value = {
    project_id: 'sample-project',
    target: { kind: 'workspace', workspace_id: 'sample-workspace' },
    incarnation: 'sample-first-binding',
  }
  const opened = vi.fn((_model: NodeFilesModel) => {})
  presenter.setFilesOpener(opened)
  presenter.openFiles()
  const first = opened.mock.calls[0][0]
  await first.addComment(
    {
      diffId: 'sample-diff',
      path: 'sample.txt',
      span: { side: 'R', start: 1, end: 1 },
      context: 'Sample line',
    },
    'Sample retained comment'
  )
  presenter.binding.value = { ...presenter.binding.value, incarnation: 'sample-later-binding' }
  presenter.openFiles()
  expect(opened.mock.calls[1][0] === first).toBe(true)
  first.removeComment(0)
  presenter.openFiles()
  expect(opened.mock.calls[2][0] === first).toBe(false)
  presenter.destroy()
})
it('keeps newer composer edits when an earlier turn is admitted', async () => {
  const { presenter, client, connection } = await setup()
  connection.state.value = 'connected'
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  let release!: () => void
  const flushing = vi.spyOn(client, 'flush').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  vi.spyOn(client, 'operationResult').mockResolvedValue({ result: {} })
  presenter.draft.value.text = 'Sample first turn'
  const sending = presenter.send('Sample first turn')
  await vi.waitFor(() => expect(flushing).toHaveBeenCalledOnce())
  presenter.draft.value.text = 'Sample next draft'
  release()
  await sending
  presenter.destroy()
  const reopened = new NodeChatPresenter(reference, connection)
  await reopened.refresh()
  expect(reopened.draft.value.text).toBe('Sample next draft')
  reopened.destroy()
})
