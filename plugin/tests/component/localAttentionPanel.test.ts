import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import LocalAttentionPanel from '@/components/LocalAttentionPanel.vue'
import type { ChatSession } from '@/ai/ChatSession'

describe('local attention history', () => {
  it('shows saved question text as interrupted, without pretending a resolver survived', () => {
    const session = {
      attention: ref({
        question: {
          id: 'q',
          at: 1,
          status: 'interrupted',
          currentIndex: 0,
          answers: [],
          questions: [{ question: 'Which sample?', options: ['First', 'Second'] }],
        },
      }),
      markAttentionSeen: vi.fn(),
    } as unknown as ChatSession
    const wrapper = mount(LocalAttentionPanel, { props: { session } })
    expect(wrapper.text()).toContain('Work was interrupted')
    expect(wrapper.text()).toContain('Which sample?')
    expect(wrapper.text()).toContain('First')
    expect(wrapper.findAll('button')).toHaveLength(1)
    wrapper.unmount()
  })
  it('keeps seen errors in conversation history and does not acknowledge on mount', async () => {
    const seen = vi.fn().mockResolvedValue(undefined)
    const session = {
      attention: ref({ errors: [{ id: 'e', at: 1, text: 'Sample failure' }] }),
      markAttentionSeen: seen,
    } as unknown as ChatSession
    const wrapper = mount(LocalAttentionPanel, { props: { session } })
    expect(seen).not.toHaveBeenCalled()
    await wrapper.find('button').trigger('click')
    expect(seen).toHaveBeenCalledWith('e')
    session.attention.value.errors![0].seen = true
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Sample failure')
    expect(wrapper.text()).toContain('Seen')
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })
})
