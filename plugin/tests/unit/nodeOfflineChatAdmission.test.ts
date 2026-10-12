import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { validateParams } from '@abele/node-protocol'
import type { NodeConnection } from '@/node/NodeService'
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

// BUG: guarded chat sends await an advertised node capability; typed refusals still look accepted.
it.fails('keeps the composer draft when the node returns a typed target refusal', async () => {
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
