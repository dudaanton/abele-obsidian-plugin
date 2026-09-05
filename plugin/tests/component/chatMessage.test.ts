/**
 * The parts of a chat message its layout is pinned to.
 *
 * The alignment and the error badge are solved in CSS, and CSS can only be measured in a real
 * engine — that is the e2e tier's job (`tests/e2e/chatLayout.e2e.test.ts`). What that tier
 * cannot notice is the markup moving out from under the rules: it builds the row itself, so a
 * renamed class or a re-nested icon would leave it measuring a shape the app no longer emits
 * and reporting a pass. These assert the shape the rules are written against.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AiChatMessage from '@/components/AiChatMessage.vue'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
})

function render(message: Partial<ChatMessage> & Pick<ChatMessage, 'role'>) {
  return mount(AiChatMessage, {
    props: {
      message: { id: 'm1', content: '', timestamp: 1, ...message } as ChatMessage,
    },
  })
}

describe('a failed tool call', () => {
  it('puts the badge in the same line as the tool name and its target', () => {
    const wrapper = render({
      role: 'tool-call',
      toolName: 'edit',
      toolStatus: 'rejected',
      content: 'Notes/English Study Test/English study system.md',
    })

    const line = wrapper.find('.abele-chat-msg__tool-line')
    expect(line.exists()).toBe(true)
    // The badge shares the line with a path that can be arbitrarily long — which is the whole
    // reason it has to refuse to be squeezed.
    expect(line.find('.abele-chat-msg__tool-err-badge').text()).toBe('failed')
  })

  it('says nothing about failure while the call is still standing', () => {
    const wrapper = render({ role: 'tool-call', toolName: 'edit', toolStatus: 'approved' })

    expect(wrapper.find('.abele-chat-msg__tool-err-badge').exists()).toBe(false)
  })
})

describe('the icon beside a message', () => {
  // Both the alignment and the per-role offsets are written as `.abele-chat-msg_<role> >
  // .abele-chat-msg__icon`. A child selector stops matching the moment the icon gains a
  // wrapper, and the role class has to be on the element the icon hangs off.
  it.each([
    ['user', 'abele-chat-msg_user'],
    ['assistant', 'abele-chat-msg_assistant'],
    ['tool-call', 'abele-chat-msg_tool-call'],
  ])('hangs directly off the %s row', (role, roleClass) => {
    const wrapper = render({ role: role as ChatMessage['role'], content: 'text', toolName: 'edit' })
    const row = wrapper.element as HTMLElement

    expect(row.classList.contains(roleClass)).toBe(true)
    const icon = row.querySelector('.abele-chat-msg__icon')
    expect(icon?.parentElement).toBe(row)
  })
})

describe('a screenshot the agent took', () => {
  it('is shown under the tool call, so the person sees what the agent saw', () => {
    const app = useVault([{ path: 'Attachments/Screenshot Feed 2026-09-05 12-00-00.png', content: '' }])
    ;(
      app.vault as unknown as { getResourcePath: (f: { path: string }) => string }
    ).getResourcePath = (f) => `app://vault/${f.path}`

    const wrapper = render({
      role: 'tool-call',
      toolName: 'screenshot',
      toolStatus: 'approved',
      toolResult: 'Screenshot saved: Attachments/Screenshot Feed 2026-09-05 12-00-00.png',
    })

    expect(wrapper.find('.abele-chat-msg__image-preview').attributes('src')).toBe(
      'app://vault/Attachments/Screenshot Feed 2026-09-05 12-00-00.png'
    )
  })
})
