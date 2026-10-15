/**
 * An answer the interceptor is reading is muted, with a turning glyph by its time naming who
 * reads it; one it replaced carries the pencil of an edited reply, its tooltip naming the
 * interceptor, and opens the same window with the agent's own words and the way back.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AiChatMessage from '@/components/AiChatMessage.vue'
import AiReplyOriginalDialog from '@/components/AiReplyOriginalDialog.vue'
import { interceptorRevision } from '@/ai/replyAnnotations'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))

const answer: ChatMessage = {
  id: 'reply',
  role: 'assistant',
  content: 'The lantern is on the shelf.',
  timestamp: 1,
}

describe('an answer under the interceptor', () => {
  it('while checked, is muted with a turning glyph that says who checks it', () => {
    const view = mount(AiChatMessage, {
      props: { message: { ...answer, answerCheck: { by: 'Sample checker' } } },
    })
    expect(view.classes()).toContain('abele-chat-msg_checking')
    expect(view.find('.abele-chat-msg__checking').attributes('aria-label')).toBe(
      'Sample checker is checking this answer'
    )
    view.unmount()
  })

  it('replaced, shows the pencil naming the interceptor and opens the original with undo', async () => {
    const replaced = interceptorRevision(answer, 'The lamp is on the shelf.', 'Sample checker', 2)
    const view = mount(AiChatMessage, { attachTo: document.body, props: { message: replaced } })
    expect(view.classes()).not.toContain('abele-chat-msg_checking')
    expect(view.find('.abele-chat-msg__checking').exists()).toBe(false)
    const pencil = view.find('.abele-chat-msg__edited')
    expect(pencil.exists()).toBe(true)
    expect(pencil.attributes('aria-label')).toMatch(/^Replaced by Sample checker · /)
    await pencil.trigger('click')
    const dialog = view.findComponent(AiReplyOriginalDialog)
    expect(dialog.exists()).toBe(true)
    expect(document.body.textContent).toContain('Undo last change')
    view.unmount()
  })
})
