import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodeDelegateHistory from '@/components/NodeDelegateHistory.vue'

it('renders retained assistant answers in the quiet letter reply block', async () => {
  const message = {
    id: 'answer',
    role: 'assistant',
    content: 'Sample retained answer',
    timestamp: 1,
  }
  const wrapper = mount(NodeDelegateHistory, {
    props: {
      client: {
        request: vi.fn(async (method: string) =>
          method.endsWith('history')
            ? {
                entries: [
                  {
                    message: {
                      id: 'answer',
                      version: 1,
                      part: 0,
                      parts: 1,
                      text: JSON.stringify(message),
                    },
                  },
                ],
                next_seq: 1,
                has_more: false,
              }
            : {
                runs: [{ run_id: 'run' }],
                branches: [{ branch_id: 'branch', item: 'Sample', state: 'done' }],
              }
        ),
      } as never,
      invocation: 'sample',
      message: {
        id: 'call',
        role: 'tool-call',
        content: '',
        timestamp: 1,
        toolStatus: 'approved',
        toolResult: 'Done',
      },
      openResource: () => {},
    },
  })
  try {
    await wrapper.get('.tree-item-self').trigger('click')
    await flushPromises()
    expect(wrapper.get('.abele-chat-letter__reply').text()).toContain('Sample retained answer')
  } finally {
    wrapper.unmount()
  }
})
