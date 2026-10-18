import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodeConnection } from '@/node/NodeService'

const f = vi.hoisted(() => ({
  title: vi.fn<
    (
      messages: import('@/ai/types').ChatMessage[],
      model: import('@/ai/client').ModelConfig,
      signal: AbortSignal
    ) => Promise<string>
  >(async () => 'Sample refactoring'),
}))
vi.mock('@/ai/chatTitle', () => ({ generateChatTitle: f.title }))
vi.mock('@/ai/ChatService', () => ({
  ChatService: { getInstance: () => ({ getAuxiliaryModelConfig: () => ({}) }) },
}))

afterEach(() => {
  vi.restoreAllMocks()
  f.title.mockReset().mockResolvedValue('Sample refactoring')
})

async function fixture(title = 'New chat') {
  const store = new MemoryClientStore()
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    store
  )
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  const reference = {
    kind: 'node-session' as const,
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    sessionId: 'sample-session',
    title,
  }
  const session = {
    session_id: reference.sessionId,
    title,
    provider: 'fake' as const,
    created_at: '2025-01-01T00:00:00Z',
  }
  const event = (seq: number, type: string, data: unknown) => ({
    kind: 'event' as const,
    node_id: reference.nodeId,
    stream_id: reference.sessionId,
    seq,
    type,
    data,
    actor: { kind: 'node' as const },
    at: '2025-01-01T00:00:00Z',
  })
  const history = [
    event(1, 'session.created', session),
    event(2, 'turn.started', { run_id: 'run' }),
    event(3, 'input.accepted', { input_id: 'u', text: 'Refactor the sample' }),
    event(4, 'session.update', {
      run_id: 'run',
      update: { kind: 'agent_message', message_id: 'a', text: 'Refactored the sample' },
    }),
    event(5, 'turn.completed', { run_id: 'run', outcome: 'success', input_ids: ['u'] }),
  ]
  await store.transaction((s) => {
    s.events[reference.sessionId] = history
  })
  vi.spyOn(client, 'getSession').mockImplementation(async () => ({ ...session }))
  const rename = vi.spyOn(client, 'renameSession').mockImplementation(async (_id, title) => {
    session.title = title
    await store.transaction((s) => {
      s.events[reference.sessionId].push(event(6, 'session.updated', { ...session }))
    })
    return session
  })
  const connection = { client, state: ref('connected') } as unknown as NodeConnection
  const presenter = new NodeChatPresenter(reference, connection)
  const titlesChanged = vi.fn()
  Object.assign(presenter, { onTitle: titlesChanged })
  return { presenter, reference, rename, session, client, connection, store, titlesChanged }
}

it('names a node conversation through the canonical rename API and keeps it on reopen', async () => {
  const { presenter, reference, rename, connection, titlesChanged } = await fixture()
  try {
    await presenter.refresh()
    await vi.waitFor(() =>
      expect(rename).toHaveBeenCalledWith(reference.sessionId, 'Sample refactoring')
    )
    await presenter.refresh()
    expect(presenter.label.value).toBe('Sample refactoring')
    expect(presenter.reference.title).toBe('Sample refactoring')
    expect(titlesChanged).toHaveBeenCalledOnce()
    const reopened = new NodeChatPresenter(reference, connection)
    try {
      await reopened.refresh()
      expect(reopened.label.value).toBe('Sample refactoring')
      expect(rename).toHaveBeenCalledOnce()
    } finally {
      reopened.destroy()
    }
  } finally {
    presenter.destroy()
  }
})

it('keeps a title chosen by the person', async () => {
  const { presenter, rename } = await fixture('Chosen title')
  try {
    await presenter.refresh()
    expect(f.title).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
    expect(presenter.label.value).toBe('Chosen title')
  } finally {
    presenter.destroy()
  }
})

it('names a completed turn even when the agent returns no text', async () => {
  const { presenter, reference, rename, store } = await fixture()
  await store.transaction((state) => {
    state.events[reference.sessionId] = state.events[reference.sessionId].filter(
      (event) => event.seq !== 4
    )
  })
  try {
    await presenter.refresh()
    await vi.waitFor(() =>
      expect(rename).toHaveBeenCalledWith(reference.sessionId, 'Sample refactoring')
    )
  } finally {
    presenter.destroy()
  }
})

it('keeps a remote rename made during generation', async () => {
  let finish!: (title: string) => void
  f.title.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { presenter, rename, session, client } = await fixture()
  try {
    await presenter.refresh()
    await vi.waitFor(() => expect(f.title).toHaveBeenCalledOnce())
    session.title = 'Remote title'
    finish('Generated title')
    await vi.waitFor(() => expect(client.getSession).toHaveBeenCalledOnce())
    expect(rename).not.toHaveBeenCalled()
  } finally {
    presenter.destroy()
  }
})

it('aborts generation when the tab closes without renaming the session', async () => {
  let finish!: (title: string) => void
  f.title.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { presenter, rename } = await fixture()
  try {
    await presenter.refresh()
    await vi.waitFor(() => expect(f.title).toHaveBeenCalledOnce())
    const signal = f.title.mock.calls[0][2] as AbortSignal
    presenter.destroy()
    expect(signal.aborted).toBe(true)
    finish('Generated title')
    await Promise.resolve()
    expect(rename).not.toHaveBeenCalled()
  } finally {
    presenter.destroy()
  }
})
