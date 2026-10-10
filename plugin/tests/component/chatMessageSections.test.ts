import { afterEach, beforeEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AiChatMessage from '@/components/AiChatMessage.vue'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const mounted: Array<{ unmount(): void }> = []
beforeEach(() => {
  useVault([])
})
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

it('keeps interceptor input when its section is hidden and trims and clears a reply', async () => {
  const message: ChatMessage = {
    id: 'sample-draft',
    role: 'user',
    content: 'Sample draft',
    timestamp: 1,
    draft: true,
  }
  const reviewed: ChatMessage = {
    ...message,
    interceptorChat: [
      { id: 'sample-review', role: 'assistant', content: 'Sample review', timestamp: 2 },
    ],
  }
  const wrapper = mount(AiChatMessage, { props: { message: reviewed } })
  mounted.push(wrapper)
  await wrapper.get('.abele-chat-msg__interceptor-textarea').setValue('  Sample reply  ')
  await wrapper.setProps({ message })
  expect(wrapper.find('.abele-chat-msg__interceptor').exists()).toBe(false)
  await wrapper.setProps({ message: reviewed })
  expect(
    (wrapper.get('.abele-chat-msg__interceptor-textarea').element as HTMLTextAreaElement).value
  ).toBe('  Sample reply  ')
  await wrapper
    .get('.abele-chat-msg__interceptor-textarea')
    .trigger('keydown', { key: 'Enter', shiftKey: true })
  expect(wrapper.emitted('send-interceptor')).toEqual([['sample-draft', 'Sample reply']])
  expect(
    (wrapper.get('.abele-chat-msg__interceptor-textarea').element as HTMLTextAreaElement).value
  ).toBe('')
  expect(wrapper.get('.abele-chat-msg__interceptor').element.parentElement).toBe(wrapper.element)
})
