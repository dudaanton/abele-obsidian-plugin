/**
 * Several interceptors in a row, as the chat shows them: a quiet count beside the turning glyph
 * of an answer being read, the place a held message waits at, "Send as is" once one has failed,
 * and the replaced answer's versions, one per interceptor, each with what that one said.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AiChatMessage from '@/components/AiChatMessage.vue'
import AiReplyOriginalDialog from '@/components/AiReplyOriginalDialog.vue'
import Tabs from '@/components/obsidian/Tabs.vue'
import Diff from '@/components/Diff.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
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

const held: ChatMessage = {
  id: 'held',
  role: 'user',
  content: 'Sample question +1',
  timestamp: 1,
  draft: true,
  interceptorName: 'Sample style check',
  interceptorChat: [
    {
      id: 'l1',
      role: 'assistant',
      content: 'Changed by Sample first.',
      timestamp: 1,
      by: 'Sample first',
    },
  ],
  interceptorWait: { entry: 'ic-2', at: 2, of: 3 },
}

describe('an answer read by several', () => {
  it('counts which one reads it beside the turning glyph, and names it', () => {
    const view = mount(AiChatMessage, {
      props: { message: { ...answer, answerCheck: { by: 'Sample checker', at: 2, of: 3 } } },
    })
    expect(view.find('.abele-chat-msg__check-count').text()).toBe('2/3')
    expect(view.find('.abele-chat-msg__checking').attributes('aria-label')).toBe(
      'Sample checker is checking this answer · 2 of 3'
    )
    view.unmount()
  })

  it('read by one, shows no count', () => {
    const view = mount(AiChatMessage, {
      props: { message: { ...answer, answerCheck: { by: 'Sample checker' } } },
    })
    expect(view.find('.abele-chat-msg__check-count').exists()).toBe(false)
    view.unmount()
  })
})

describe('a message held among several', () => {
  it('says where it waits, and whose each line is', () => {
    const view = mount(AiChatMessage, { props: { message: held } })
    expect(view.find('.abele-chat-msg__interceptor-step').text()).toBe('2 of 3: Sample style check')
    view.unmount()
    const two = mount(AiChatMessage, {
      props: {
        message: {
          ...held,
          interceptorChat: [
            ...held.interceptorChat!,
            {
              id: 'l2',
              role: 'assistant',
              content: 'Reads fine.',
              timestamp: 2,
              by: 'Sample reviewer',
            },
          ],
        },
      },
    })
    expect(two.findAll('.abele-chat-msg__interceptor-by').map((b) => b.text())).toEqual([
      'Sample first',
      'Sample reviewer',
    ])
    two.unmount()
  })

  it('offers Send while it waits for the person, and Send as is with Retry once one failed', () => {
    const waiting = mount(AiChatMessage, { props: { message: held } })
    expect(waiting.find('.abele-chat-msg__draft-btn--send').text()).toBe('Send')
    waiting.unmount()

    const error = 'Sample style check, 2 of 3: the script threw. Retry, or send it as is.'
    const failed = mount(AiChatMessage, {
      props: {
        message: { ...held, interceptorWait: { ...held.interceptorWait!, error } },
        interceptorError: error,
      },
    })
    expect(failed.find('.abele-chat-msg__draft-btn--send').text()).toBe('Send as is')
    expect(failed.find('.abele-chat-msg__interceptor-error').text()).toContain(error)
    expect(failed.find('.abele-chat-msg__interceptor-error').text()).toContain('Retry')
    failed.unmount()
  })
})

/** What the interceptor of the version shown said, as the dialog draws it. */
const said = (view: ReturnType<typeof mount>) =>
  view
    .findAllComponents(Markdown)
    .filter((m) => m.element.closest('.abele-reply-original__said'))
    .map((m) => m.props('text') as string)

describe('the versions of an answer replaced by several', () => {
  const twice = () => {
    const once = interceptorRevision(answer, 'The lamp is on the shelf.', 'Sample first', 2)
    const both = interceptorRevision(once, 'The lamp is on the high shelf.', 'Sample second', 3)
    return {
      ...both,
      interceptorChat: [
        {
          id: 'n1',
          role: 'assistant' as const,
          content: 'Sample first note.',
          timestamp: 2,
          by: 'Sample first',
        },
        {
          id: 'n2',
          role: 'assistant' as const,
          content: 'Sample second note.',
          timestamp: 3,
          by: 'Sample second',
        },
      ],
    }
  }

  it('opens on the last one, and each tab shows what that one changed and said', async () => {
    const view = mount(AiReplyOriginalDialog, {
      attachTo: document.body,
      props: { message: twice() },
    })
    const tabs = view.findComponent(Tabs)
    expect((tabs.props('tabs') as { label: string }[]).map((t) => t.label)).toEqual([
      'Original',
      '1 · Sample first',
      '2 · Sample second',
    ])
    expect(tabs.props('modelValue')).toBe('1')
    expect(view.findComponent(Diff).props()).toMatchObject({
      textLeft: 'The lamp is on the shelf.',
      textRight: 'The lamp is on the high shelf.',
    })
    expect(said(view)).toEqual(['Sample second note.'])

    await tabs.vm.$emit('update:modelValue', '0')
    expect(view.findComponent(Diff).props()).toMatchObject({
      textLeft: 'The lantern is on the shelf.',
      textRight: 'The lamp is on the shelf.',
    })
    expect(said(view)).toEqual(['Sample first note.'])
    view.unmount()
  })

  it('changed by one, keeps the two tabs it had', () => {
    const once = interceptorRevision(answer, 'The lamp is on the shelf.', 'Sample first', 2)
    const view = mount(AiReplyOriginalDialog, { attachTo: document.body, props: { message: once } })
    expect(
      (view.findComponent(Tabs).props('tabs') as { label: string }[]).map((t) => t.label)
    ).toEqual(['Changes', 'Original'])
    view.unmount()
  })
})
