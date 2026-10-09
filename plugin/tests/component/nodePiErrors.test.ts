import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { expect, it, vi } from 'vitest'
import NodeChatView from '@/components/NodeChatView.vue'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { nodeQueueView } from '@/node/presentation'
import type { JournalEvent } from '@abele/channel-protocol'
import { useVault } from '../helpers/testEnv'

const fixture = (status = 400) => {
  useVault([])
  const event = (seq: number, type: string, data: unknown): JournalEvent => ({
    kind: 'event',
    node_id: 'sample-node',
    stream_id: 'sample-session',
    seq,
    type,
    actor: { kind: 'node' },
    at: '2025-01-01T00:00:00.000Z',
    data,
  })
  const projection = reduceTranscript([
    event(1, 'input.accepted', { input_id: 'sample-input', text: 'Sample failed question' }),
    event(2, 'run.started', { run_id: 'sample-run', input_id: 'sample-input' }),
    event(3, 'pi.message.final', {
      run_id: 'sample-run',
      message_id: 'sample-final',
      http_status: status,
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'provider_error (details retained only locally by SDK)',
      },
    }),
  ])
  const presentation = nodeQueueView(projection.messages, [], [], {
    'sample-operation': { result: { input_id: 'sample-input', accepted_seq: 1 } },
  })
  const presenter = {
    id: 'sample',
    label: ref('Sample session'),
    messages: ref(projection.messages),
    projection: ref(projection),
    presentation: ref(presentation),
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
  return { wrapper, presenter }
}

it('resends the canonical failed input after receipt identity changes the displayed row', async () => {
  const { wrapper, presenter } = fixture()
  try {
    expect(presenter.presentation.value.messages[0].id).toBe('operation:sample-operation')
    await wrapper.get('[aria-label="Send again"]').trigger('click')
    await flushPromises()
    expect(presenter.send).toHaveBeenCalledExactlyOnceWith('Sample failed question')
  } finally {
    wrapper.unmount()
  }
})
it.each([502, 400])('shows the retained HTTP %s cause without internal codes', (status) => {
  const { wrapper } = fixture(status)
  try {
    expect(wrapper.get('[role="alert"]').text()).toContain(
      `The agent could not answer: the model service returned an error (HTTP ${status}).`
    )
    expect(wrapper.get('[role="alert"]').text()).not.toMatch(/provider_error|SDK|journal/)
  } finally {
    wrapper.unmount()
  }
})
it('places the native resend action inside the error row', () => {
  const { wrapper } = fixture()
  try {
    expect(wrapper.get('[role="alert"] button[aria-label="Send again"]').classes()).toContain(
      'clickable-icon'
    )
  } finally {
    wrapper.unmount()
  }
})
it('aligns collapsed Details with the shared message body and leads with a plain diagnostic', () => {
  const { wrapper } = fixture()
  try {
    const details = wrapper.get('details')
    expect(details.get('summary').text()).toBe('Details')
    expect((details.element as HTMLDetailsElement).open).toBe(false)
    expect(details.classes()).toContain('abele-chat-msg__body')
    const diagnostic = details.get('.abele-node-chat__diagnostic')
    expect(diagnostic.text()).toContain('HTTP 400')
    expect(diagnostic.text()).not.toMatch(/provider_error|SDK|sample-final|sample-run/)
    expect(
      diagnostic.element.compareDocumentPosition(details.get('pre').element) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  } finally {
    wrapper.unmount()
  }
})
