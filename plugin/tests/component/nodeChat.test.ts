import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Menu } from 'obsidian'
import NodeChatView from '@/components/NodeChatView.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import ChatToolRun from '@/components/ChatToolRun.vue'
import AiChatInput from '@/components/AiChatInput.vue'
import VoiceRecorder from '@/components/VoiceRecorder.vue'
import Button from '@/components/obsidian/Button.vue'
import { useVault } from '../helpers/testEnv'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import type { JournalEvent } from '@abele/channel-protocol'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { chatMovedNotice } from '@/node/expectedTarget'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { NodeClientStore } from '@/node/NodeClientStore'
import type { NodeConnection } from '@/node/NodeService'

it.each(['offline', 'disconnect during admission'])(
  'keeps a submission in the composer across closing and reload, and sends only on request (%s)',
  async (mode) => {
    useVault([])
    const factory = new IDBFactory()
    const reference = {
      kind: 'node-session' as const,
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      sessionId: 'sample-session',
      title: 'Sample session',
    }
    const create = () => {
      const store = new NodeClientStore('sample-draft', factory)
      const client = new NodeClient(
        { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
        store
      )
      const connection = {
        client,
        state: ref('offline'),
        error: ref(''),
      } as unknown as NodeConnection
      return { store, client, connection, presenter: new NodeChatPresenter(reference, connection) }
    }
    const mountChat = (presenter: NodeChatPresenter) =>
      mount(NodeChatView, { props: { presenter }, global: { stubs: { VoiceRecorder: true } } })
    let session = create()
    let wrapper = mountChat(session.presenter)
    const text = '  Sample offline words\nwith a second line  '
    try {
      await session.presenter.refresh()
      let cursor: ReturnType<typeof vi.spyOn> | undefined
      let online: ReturnType<typeof vi.spyOn> | undefined
      if (mode === 'disconnect during admission') {
        vi.spyOn(session.client, 'subscribe').mockResolvedValue(undefined)
        online = vi.spyOn(session.client, 'connected', 'get').mockReturnValue(true)
        session.connection.state.value = 'connected'
        cursor = vi.spyOn(session.client, 'cursor').mockImplementation(async () => {
          session.connection.state.value = 'offline'
          return 3
        })
      }
      // A loaded event loop can deliver the reconnect grace timers late.
      const setTimeout = window.setTimeout.bind(window)
      const delayedTimers = vi
        .spyOn(window, 'setTimeout')
        .mockImplementation((handler, delay, ...args) =>
          setTimeout(handler, delay === 100 ? 250 : delay, ...args)
        )
      const send = vi.spyOn(session.presenter, 'send')
      await wrapper.get('textarea').setValue(text)
      await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
      expect(send).toHaveBeenCalledOnce()
      await send.mock.results[0].value
      await flushPromises()
      expect(wrapper.find('.abele-node-chat__draft-note').exists()).toBe(true)
      expect(wrapper.find('[data-icon="loader"]').exists()).toBe(false)
      expect(session.presenter.draft.value.text).toBe(text)
      expect(wrapper.get('textarea').element.value).toBe(text)
      expect(wrapper.get('[role="status"].abele-node-chat__draft-note').text()).toContain(
        'not sent'
      )
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(await session.client.pending()).toEqual([])
      expect(wrapper.get('[aria-label="Send again"]').exists()).toBe(true)
      delayedTimers.mockRestore()
      cursor?.mockRestore()
      online?.mockRestore()

      wrapper.unmount()
      session.presenter.destroy()
      session.store.close()
      session = create()
      await session.presenter.refresh()
      wrapper = mountChat(session.presenter)
      expect(wrapper.get('textarea').element.value).toBe(text)
      expect(wrapper.get('.abele-node-chat__draft-note').text()).toContain('offline')
      const subscribe = vi.spyOn(session.client, 'subscribe').mockResolvedValue(undefined)
      const connected = vi.spyOn(session.client, 'connected', 'get').mockReturnValue(true)
      const flush = vi.spyOn(session.client, 'flush').mockImplementation(async () => {
        await session.store.transaction((state) => {
          const operation = state.outbox.shift()!
          state.results[operation.operation_id] = { result: {} }
        })
      })
      session.connection.state.value = 'connected'
      await flushPromises()
      expect(await session.client.pending()).toEqual([])
      expect(flush).not.toHaveBeenCalled()
      expect(wrapper.get('textarea').element.value).toBe(text)
      const resend = vi.spyOn(session.presenter, 'send')
      await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
      expect(resend).toHaveBeenCalledOnce()
      await resend.mock.results[0].value
      await flushPromises()
      expect(wrapper.get('textarea').element.value).toBe('')
      expect(wrapper.find('[data-icon="loader"]').exists()).toBe(false)
      expect(flush).toHaveBeenCalledOnce()
      expect(wrapper.find('.abele-node-chat__draft-note').exists()).toBe(false)
      subscribe.mockRestore()
      connected.mockRestore()
      flush.mockRestore()
      wrapper.unmount()
      session.presenter.destroy()
      await session.store.transaction(() => undefined)
      const reopened = create()
      await reopened.presenter.refresh()
      expect(reopened.presenter.draft.value.text).toBe('')
      reopened.presenter.destroy()
      reopened.store.close()
    } finally {
      wrapper.unmount()
      session.presenter.destroy()
      session.store.close()
      vi.restoreAllMocks()
    }
  }
)

it.each([true, false])(
  'keeps a refused draft in the real composer without auto-resend (supported: %s)',
  async (supported) => {
    useVault([])
    const store = new MemoryClientStore()
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
      store
    )
    vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
    const connection = {
      client,
      state: ref('connected'),
      error: ref(''),
    } as unknown as NodeConnection
    const presenter = new NodeChatPresenter(
      {
        kind: 'node-session',
        nodeId: 'sample-node',
        registrationId: 'sample-registration',
        sessionId: 'sample-session',
        title: 'Sample session',
      },
      connection
    )
    presenter.nodeDescription.value = { version: supported ? '0.4.2' : '0.4.1' }
    const target = {
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      projectId: 'sample-project',
      kind: 'worktree' as const,
      id: 'sample-tree',
      incarnation: 'sample-old-binding',
    }
    const actual = {
      project_id: target.projectId,
      target: { kind: 'worktree' as const, worktree_id: target.id },
      incarnation: 'sample-new-binding',
    }
    vi.spyOn(client.nodePath, 'sessionWorktreeGet').mockResolvedValue(actual)
    const requests: unknown[] = []
    const flush = vi.spyOn(client, 'flush').mockImplementation(async () => {
      await store.transaction((state) => {
        const operation = state.outbox.shift()!
        requests.push(operation.params)
        state.results[operation.operation_id] = {
          result:
            requests.length === 1
              ? {
                  code: 'target_changed',
                  current_target: { target: actual.target, incarnation: actual.incarnation },
                }
              : { input_id: 'sample-input', accepted_seq: 1 },
        }
      })
    })
    const wrapper = mount(NodeChatView, {
      props: { presenter, currentTarget: target },
      global: { stubs: { VoiceRecorder: true } },
    })
    try {
      const draft = '  Sample retained words\nwith another line  '
      await wrapper.get('textarea').setValue(draft)
      await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
      await vi.waitFor(() =>
        expect(wrapper.get('.abele-node-chat__draft-note').text()).toBe(chatMovedNotice)
      )
      expect(wrapper.get('textarea').element.value).toBe(draft)
      expect(wrapper.get('[aria-label="Send again"]').exists()).toBe(true)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      await flushPromises()
      expect(flush).toHaveBeenCalledOnce()
      expect(await client.pending()).toEqual([])
      if (supported)
        expect(requests[0]).toHaveProperty('expected_target.incarnation', 'sample-old-binding')
      else expect(requests[0]).not.toHaveProperty('expected_target')
      await wrapper.setProps({ currentTarget: { ...target, incarnation: actual.incarnation } })
      await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
      await vi.waitFor(() => expect(wrapper.get('textarea').element.value).toBe(''))
      expect(flush).toHaveBeenCalledTimes(2)
      if (supported)
        expect(requests[1]).toHaveProperty('expected_target.incarnation', 'sample-new-binding')
    } finally {
      wrapper.unmount()
      presenter.destroy()
      vi.restoreAllMocks()
    }
  }
)

it.each([false, true])(
  'shows a failed pi turn and resends its input (follow-up: %s)',
  async (followup) => {
    useVault([])
    const status = followup ? 400 : 502
    const record = (seq: number, type: string, data: unknown): JournalEvent => ({
      kind: 'event',
      node_id: 'sample-node',
      stream_id: 'sample-session',
      seq,
      type,
      actor: { kind: 'node' },
      at: '2025-01-01T00:00:00.000Z',
      data,
    })
    const failure = record(7, 'pi.message.final', {
      run_id: 'sample-failed',
      message_id: 'failed',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: `${status} Sample rejection`,
      },
    })
    const projection = reduceTranscript([
      record(1, 'pi.session.bound', {}),
      ...(followup
        ? [
            record(2, 'input.accepted', { input_id: 'first', text: 'First question' }),
            record(3, 'pi.message.final', {
              run_id: 'first',
              message_id: 'reply',
              message: { role: 'assistant', content: [{ type: 'text', text: 'Sample answer' }] },
            }),
          ]
        : []),
      record(4, 'input.accepted', { input_id: 'failed-input', text: 'Sample failed question' }),
      record(5, 'run.started', { run_id: 'sample-failed', input_id: 'failed-input' }),
      record(6, 'input.accepted', { input_id: 'queued-input', text: 'Different queued question' }),
      failure,
    ])
    const presenter = {
      id: 'sample',
      label: ref('Sample session'),
      messages: ref(projection.messages),
      projection: ref(projection),
      state: ref('needs-attention'),
      queued: ref([]),
      rejected: ref([]),
      error: ref(''),
      draft: ref({ text: '', attachments: [] }),
      connection: { state: ref('connected'), error: ref('') },
      send: vi.fn(),
      openResource: vi.fn(),
    }
    const wrapper = mount(NodeChatView, {
      props: { presenter: presenter as never },
      global: { stubs: { AiChatInput: true, Icon: true, Button: true } },
    })
    try {
      expect(wrapper.get('.abele-chat-msg_assistant [role="alert"]').text()).toContain(
        `HTTP ${status}`
      )
      // The regular chat shows no raw records: the failure is said on its answer, nothing else.
      expect(wrapper.find('details').exists()).toBe(false)
      const retry = wrapper
        .findAllComponents(Button)
        .find((button) => button.props('text') === 'Retry')!
      await retry.vm.$emit('click')
      await flushPromises()
      expect(presenter.send).toHaveBeenCalledExactlyOnceWith('Sample failed question')
      presenter.connection.state.value = 'offline'
      await flushPromises()
      expect(retry.props('disabled')).toBe(true)
    } finally {
      wrapper.unmount()
    }
  }
)

it.each([false, true, undefined])(
  'offers Debug only with advertised availability (%s)',
  async (available) => {
    useVault([])
    const presenter = {
      id: 'sample-gate',
      label: ref('Sample session'),
      messages: ref([]),
      projection: ref({
        messages: [],
        prompts: [],
        artifacts: [],
        unknown: [],
        state: 'idle',
        activeRuns: [],
      }),
      state: ref('idle'),
      queued: ref([]),
      rejected: ref([]),
      error: ref(''),
      draft: ref({ text: '', attachments: [] }),
      connection: { state: ref('connected'), error: ref('') },
      debuggerAvailable: ref(available),
      send: vi.fn(),
      openResource: vi.fn(),
    }
    const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
    const w = mount(NodeChatView, {
      props: { presenter: presenter as never },
      global: { stubs: { AiChatInput: true } },
    })
    try {
      await w.get('[aria-label="More chat actions"]').trigger('click')
      const titles = (shown.mock.contexts.at(-1) as Menu).items.map((i) => i.title)
      expect(titles.includes('Debug')).toBe(available === true)
      // Attaching to a running program follows the same rule as running one, beside it.
      expect(titles.includes('Run a program')).toBe(available === true)
      expect(titles.includes('Attach to a running program')).toBe(available === true)
      if (available)
        expect(titles.indexOf('Attach to a running program')).toBe(
          titles.indexOf('Run a program') + 1
        )
    } finally {
      w.unmount()
      shown.mockRestore()
    }
  }
)
it('uses the shared composer and renderer, labels offline queue and never offers local history controls', async () => {
  useVault([])
  const send = vi.fn()
  const presenter = {
    id: 'sample',
    label: ref('Sample session'),
    messages: ref([{ id: 'i', role: 'user', content: 'Sample input', timestamp: 0 }]),
    projection: ref({ messages: [], prompts: [], artifacts: [], unknown: [], state: 'idle' }),
    state: ref('offline'),
    queued: ref([{ id: 'pending', text: 'Queued input' }]),
    rejected: ref([]),
    error: ref(''),
    draft: ref({ text: '', attachments: [] }),
    connection: { state: ref('offline'), error: ref(''), connect: vi.fn() },
    capabilities: { editHistory: false },
    send,
    answer: vi.fn(),
    openResource: vi.fn(),
  }
  const wrapper = mount(NodeChatView, {
    props: { presenter: presenter as never },
    global: { stubs: { AiChatInput: true, Icon: true, Button: true } },
  })
  await flushPromises()
  // Offline is a red dot before where the agent works, the word in its tooltip.
  expect(wrapper.find('.abele-node-chat__offline').attributes('aria-label')).toBe('Offline')
  expect(wrapper.text()).toContain('Queued input')
  expect(wrapper.findComponent({ name: 'AiChatMessage' }).props('readOnlyHistory')).toBe(true)
  expect(wrapper.findComponent({ name: 'AiChatInput' }).props('textOnly')).toBe(true)
  wrapper.findComponent({ name: 'AiChatInput' }).vm.$emit('send', 'Hello', [])
  await flushPromises()
  expect(send).toHaveBeenCalledWith('Hello')
  wrapper.unmount()
})

it('restores exact Claude permission cards and nested work without fake controls', async () => {
  useVault([])
  const prompt = {
    prompt_id: 'sample-approval',
    state: 'pending',
    tool_name: 'Bash',
    input: { command: 'printf sample' },
    expires_at: 1999999999999,
  }
  const answer = vi.fn()
  const presenter = {
    id: 'claude',
    label: ref('Sample coding task'),
    provider: ref('claude'),
    nativeSessionId: ref('sample-native'),
    messages: ref([
      { id: 'parent', role: 'tool-call', content: '', toolName: 'Agent', timestamp: 0 },
    ]),
    projection: ref({
      activeRuns: ['run'],
      queuedInputs: [{ id: 'i', text: 'Follow-up' }],
      children: {
        parent: [{ id: 'child', role: 'assistant', content: '**Nested result**', timestamp: 0 }],
      },
      prompts: [prompt],
      artifacts: [],
      unknown: [],
    }),
    state: ref('needs-attention'),
    queued: ref([]),
    rejected: ref([]),
    error: ref(''),
    draft: ref({ text: '', attachments: [] }),
    connection: { state: ref('connected'), error: ref('') },
    answer,
    stopFromApproval: vi.fn(),
    openResource: vi.fn(),
    send: vi.fn(),
    interrupt: vi.fn(),
    cancelInput: vi.fn(),
  }
  const menuShown = vi.spyOn(Menu.prototype, 'showAtPosition')
  const mountChat = () =>
    mount(NodeChatView, {
      props: { presenter: presenter as never },
      global: { stubs: { Markdown: true, AiChatInput: true } },
    })
  let wrapper = mountChat()
  wrapper.unmount()
  wrapper = mountChat()
  try {
    // The header names the agent as the regular chat's does; the chat's name is on its tab.
    expect(wrapper.get('.abele-node-chat__agent').text()).toBe('Claude Code')
    expect(wrapper.text()).not.toContain('Ask for permission')
    expect(wrapper.text()).toContain('printf sample')
    expect(wrapper.text()).not.toContain('not supported yet')
    await wrapper.get('[aria-label="More chat actions"]').trigger('click')
    // The menu holds what the chat can do, not what it cannot.
    expect((menuShown.mock.contexts.at(-1) as Menu).items.map((i) => i.title)).not.toContain(
      'Steer turn'
    )
    // Nested work is inside the run of calls, folded like the regular chat's; opened, it shows.
    wrapper.findComponent(ChatToolRun).vm.$emit('update:open', true)
    await flushPromises()
    const rendered = wrapper.findAllComponents(AiChatMessage)
    expect(
      rendered.filter((c) => ['parent', 'child'].includes(c.props('message').id))
    ).toHaveLength(2)
    expect(rendered).toHaveLength(3)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Approve')!
      .trigger('click')
    await flushPromises()
    expect(answer).toHaveBeenCalledWith(prompt, 'allow')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Stop')!
      .trigger('click')
    expect(presenter.stopFromApproval).toHaveBeenCalledWith(prompt)
    await wrapper.get('[aria-label="Cancel queued input"]').trigger('click')
    expect(presenter.cancelInput).toHaveBeenCalledWith('i')
  } finally {
    menuShown.mockRestore()
    wrapper.unmount()
  }
})

it.each([
  { textOnly: false, isStreaming: false },
  { textOnly: false, isStreaming: true },
  { textOnly: true, isStreaming: false },
  { textOnly: true, isStreaming: true },
])(
  'keeps one dictation control and only local attachments ($textOnly, $isStreaming)',
  async ({ textOnly, isStreaming }) => {
    useVault([])
    const wrapper = mount(AiChatInput, {
      props: {
        textOnly,
        isStreaming,
        isBusy: false,
        canContinue: false,
        tokenDisplay: '',
        scopeLabel: '',
      },
      global: { stubs: { VoiceRecorder: true } },
    })
    try {
      expect(wrapper.findAll('[data-icon="paperclip"]')).toHaveLength(textOnly ? 0 : 1)
      expect(wrapper.findAll('[data-icon="mic"]')).toHaveLength(1)
      await wrapper.get('[data-icon="mic"]').trigger('click')
      wrapper.findComponent(VoiceRecorder).vm.$emit('send', 'Sample dictated words')
      await flushPromises()
      expect(wrapper.emitted('send')).toEqual([['Sample dictated words', []]])
      expect(wrapper.get('textarea').element.value).toBe('')
      if (textOnly) {
        await wrapper.get('textarea').setValue('/new')
        await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
        expect(wrapper.emitted('send')?.[1]).toEqual(['/new', []])
        expect(wrapper.emitted('command')).toBeUndefined()
      }
    } finally {
      wrapper.unmount()
    }
  }
)

it('does not expose branch, repeat, edit, retry or rewind on a read-only node message', async () => {
  useVault([])
  const wrapper = mount(AiChatMessage, {
    props: {
      message: { id: 'i', role: 'user', content: 'Sample input', timestamp: 0 },
      readOnlyHistory: true,
    },
    global: { stubs: { Icon: true, Markdown: true } },
  })
  await wrapper.find('.abele-chat-msg__icon').trigger('click')
  for (const label of ['Branch from here', 'Repeat', 'Edit', 'Rewind', 'Retry', 'Insert into note'])
    expect(wrapper.text()).not.toContain(label)
  wrapper.unmount()
})
