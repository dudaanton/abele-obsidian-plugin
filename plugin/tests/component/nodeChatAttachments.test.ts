import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { expect, it, vi } from 'vitest'
import NodeChatView from '@/components/NodeChatView.vue'
import AiChatInput from '@/components/AiChatInput.vue'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { useVault } from '../helpers/testEnv'

it('attaches selected text to this node draft without creating a vault file or sending it', async () => {
  useVault([])
  const presenter = {
    id: 'sample-chat',
    provider: ref('pi'),
    label: ref('Sample chat'),
    projection: ref(reduceTranscript([])),
    messages: ref([]),
    state: ref('idle'),
    queued: ref([]),
    rejected: ref([]),
    error: ref(''),
    draft: ref({ text: 'Please inspect this', attachments: [] }),
    connection: { state: ref('connected'), error: ref('') },
    send: vi.fn(),
    openResource: vi.fn(),
  }
  const wrapper = mount(NodeChatView, {
    props: { presenter: presenter as never },
    global: {
      stubs: { AiChatInput: { template: '<div><slot name="attach" /></div>' } },
    },
  })
  try {
    expect(wrapper.find('button[aria-label="Attach a file"]').exists()).toBe(true)
    const input = wrapper.get('input[type="file"]')
    let finish!: (bytes: ArrayBuffer) => void
    const file = new File(['sample content'], 'sample.txt')
    vi.spyOn(file, 'arrayBuffer').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    Object.defineProperty(input.element, 'files', {
      value: [file],
      configurable: true,
    })
    await input.trigger('change')
    expect(wrapper.findComponent(AiChatInput).attributes('is-busy')).toBe('true')
    finish(new TextEncoder().encode('sample content').buffer)
    await flushPromises()
    expect(presenter.draft.value.text).toBe('Please inspect this\n\nsample.txt\n> sample content')
    expect(presenter.send).not.toHaveBeenCalled()
    expect(presenter.draft.value.attachments).toEqual([])
  } finally {
    wrapper.unmount()
  }
})
