import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodeConnection } from '@/node/NodeService'
import type { Prompt } from '@abele/node-client'

const prompt: Prompt = {
  kind: 'permission',
  prompt_id: 'sample-prompt',
  session_id: 'sample-session',
  run_id: 'sample-run',
  revision: 1,
  action_digest: 'a'.repeat(64),
  expires_at: 1999999999999,
  state: 'pending',
  choice: null,
  installation_id: null,
  delivered: false,
  tool_name: 'Bash',
  input: { command: 'printf sample' },
}
const reference = {
  kind: 'node-session' as const,
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  sessionId: prompt.session_id,
  title: 'Sample session',
}
async function fixture() {
  const factory = new IDBFactory()
  const make = () => {
    const store = new NodeClientStore('sample-answer-installation', factory)
    const client = new NodeClient(
      {
        url: 'ws://127.0.0.1:7777/channel',
        profile: 'local-token-v1',
        token: 'sample-token',
        expected_node_id: reference.nodeId,
      },
      store
    )
    // A connected fake with no transport reply: flush retains the unknown operation.
    vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
    const presenter = new NodeChatPresenter(reference, {
      client,
      state: ref('connected'),
    } as unknown as NodeConnection)
    return { store, client, presenter }
  }
  const first = make()
  await first.store.transaction((s) => {
    s.node_id = reference.nodeId
    s.events[prompt.session_id] = [
      {
        kind: 'event',
        node_id: reference.nodeId,
        stream_id: prompt.session_id,
        seq: 1,
        type: 'prompt.opened',
        data: prompt,
        actor: { kind: 'node' },
        at: '2025-01-01T00:00:00.000Z',
      },
    ]
  })
  return { first, make }
}
it('admits at most one answer during concurrent UI calls', async () => {
  const { first } = await fixture()
  try {
    await Promise.all([
      first.presenter.answer(prompt, 'allow'),
      first.presenter.answer(prompt, 'deny'),
    ])
    expect((await first.client.pending()).filter((e) => e.method === 'prompt.answer')).toHaveLength(
      1
    )
  } finally {
    first.presenter.destroy()
    first.store.close()
  }
})
it('refuses another answer after presenter and store reload with an unknown response', async () => {
  const { first, make } = await fixture()
  await first.presenter.answer(prompt, 'allow')
  const before = await first.client.pending()
  first.presenter.destroy()
  first.store.close()
  const restored = make()
  try {
    await restored.presenter.refresh()
    expect(restored.presenter.answers.value[prompt.prompt_id]).toMatchObject({
      state: 'pending',
      choice: 'allow',
    })
    await restored.presenter.answer(prompt, 'deny')
    expect(await restored.client.pending()).toEqual(before)
  } finally {
    restored.presenter.destroy()
    restored.store.close()
  }
})
it('blocks a remounted presenter while the original answer request is still in flight', async () => {
  const { first, make } = await fixture()
  let finish!: () => void
  vi.spyOn(first.client, 'flush').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const sending = first.presenter.answer(prompt, 'allow')
  await vi.waitFor(async () => expect(await first.client.pending()).toHaveLength(1))
  first.presenter.destroy()
  const remounted = make()
  try {
    await remounted.presenter.refresh()
    expect(remounted.presenter.answers.value[prompt.prompt_id].state).toBe('pending')
    await remounted.presenter.answer(prompt, 'deny')
    expect(await remounted.client.pending()).toHaveLength(1)
  } finally {
    finish()
    await sending
    first.store.close()
    remounted.presenter.destroy()
    remounted.store.close()
  }
})

it('serializes competing presenters across independent store handles', async () => {
  const { first, make } = await fixture(),
    other = make()
  try {
    await Promise.all([
      first.presenter.answer(prompt, 'allow'),
      other.presenter.answer(prompt, 'deny'),
    ])
    expect((await first.client.pending()).filter((e) => e.method === 'prompt.answer')).toHaveLength(
      1
    )
  } finally {
    first.presenter.destroy()
    other.presenter.destroy()
    first.store.close()
    other.store.close()
  }
})
it('does not block another prompt in the same run', async () => {
  const { first } = await fixture()
  try {
    await first.presenter.answer(prompt, 'allow')
    await first.presenter.answer({ ...prompt, prompt_id: 'other-prompt' }, 'deny')
    expect(
      (await first.client.pending()).map((e) => (e.params as { prompt_id: string }).prompt_id)
    ).toEqual([prompt.prompt_id, 'other-prompt'])
  } finally {
    first.presenter.destroy()
    first.store.close()
  }
})
it('recognizes a successful older receipt without the new identity metadata', async () => {
  const { first } = await fixture()
  try {
    await first.store.transaction((s) => {
      s.results['older-operation'] = { result: { ...prompt, state: 'resolved', choice: 'deny' } }
    })
    await first.presenter.answer(prompt, 'allow')
    expect(await first.client.pending()).toEqual([])
    expect(first.presenter.answers.value[prompt.prompt_id]).toMatchObject({
      state: 'answered',
      choice: 'deny',
    })
  } finally {
    first.presenter.destroy()
    first.store.close()
  }
})
it.each([undefined, 'stale_revision'])(
  'retains answer identity beside durable results before journal resolution (%s)',
  async (error) => {
    const { first, make } = await fixture()
    await first.presenter.answer(prompt, 'allow')
    const queued = (await first.client.pending())[0]
    await first.store.transaction((s) => {
      s.results[queued.operation_id] = error
        ? { error }
        : { result: { ...prompt, state: 'resolved', choice: 'allow' } }
      s.outbox = []
    })
    first.presenter.destroy()
    first.store.close()
    const restored = make()
    try {
      await restored.presenter.refresh()
      await restored.presenter.answer(prompt, 'deny')
      expect(await restored.client.pending()).toEqual([])
      expect(
        (await restored.store.transaction((s) => s.results[queued.operation_id])).answer
      ).toMatchObject({ sessionId: prompt.session_id, promptId: prompt.prompt_id, choice: 'allow' })
    } finally {
      restored.presenter.destroy()
      restored.store.close()
    }
  }
)
