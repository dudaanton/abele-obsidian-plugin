import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodeConnection } from '@/node/NodeService'
import NodeChatView from '@/components/NodeChatView.vue'
import { useVault } from '../helpers/testEnv'

it('shows the durable answer as sent after view remount and presenter/store reload, without a second choice', async () => {
  useVault([])
  const factory = new IDBFactory()
  const prompt = {
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
  const make = () => {
    const store = new NodeClientStore('sample-answer-ui', factory)
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
      store
    )
    vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
    const presenter = new NodeChatPresenter(
      {
        kind: 'node-session',
        nodeId: 'sample-node',
        registrationId: 'sample-registration',
        sessionId: prompt.session_id,
        title: 'Sample task',
      },
      { client, state: ref('connected'), error: ref('') } as unknown as NodeConnection
    )
    return { store, client, presenter }
  }
  const mountView = (presenter: NodeChatPresenter) =>
    mount(NodeChatView, { props: { presenter }, global: { stubs: { AiChatInput: true } } })
  const first = make()
  await first.store.transaction((s) => {
    s.node_id = 'sample-node'
    s.events[prompt.session_id] = [
      {
        kind: 'event',
        node_id: 'sample-node',
        stream_id: prompt.session_id,
        seq: 1,
        type: 'prompt.opened',
        data: prompt,
        actor: { kind: 'node' },
        at: '2025-01-01T00:00:00.000Z',
      },
    ]
  })
  await first.presenter.refresh()
  let view = mountView(first.presenter)
  const allow = view.findAll('button').find((b) => b.text() === 'Allow')!
  await allow.trigger('click')
  await flushPromises()
  const pending = await first.client.pending()
  expect(pending).toHaveLength(1)
  view.unmount()
  view = mountView(first.presenter)
  expect(view.text()).toContain('Answer sent')
  expect(view.findAll('.abele-node-permission button')).toHaveLength(0)
  view.unmount()
  first.presenter.destroy()
  first.store.close()
  const restored = make()
  try {
    await restored.presenter.refresh()
    view = mountView(restored.presenter)
    expect(view.text()).toContain('Answer sent')
    expect(view.findAll('.abele-node-permission button')).toHaveLength(0)
    expect(await restored.client.pending()).toEqual(pending)
  } finally {
    view.unmount()
    restored.presenter.destroy()
    restored.store.close()
  }
})
