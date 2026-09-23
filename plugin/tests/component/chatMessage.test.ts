/**
 * The parts of a chat message its layout is pinned to.
 *
 * The alignment and the error badge are solved in CSS, and CSS can only be measured in a real
 * engine — that is the e2e tier's job (`tests/e2e/chatLayout.e2e.test.ts`). What that tier
 * cannot notice is the markup moving out from under the rules: it builds the row itself, so a
 * renamed class or a re-nested icon would leave it measuring a shape the app no longer emits
 * and reporting a pass. These assert the shape the rules are written against.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AiChatMessage from '@/components/AiChatMessage.vue'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

// The map draws itself with WebGL, which there is none of here. What is asserted below is
// that the chat asks for one at all, and with what.
const renderMap = vi.hoisted(() => vi.fn(async () => ({ destroy: vi.fn() })))
vi.mock('@/helpers/mapRender', () => ({ renderMap }))

beforeEach(() => {
  useVault([])
  renderMap.mockReset()
  renderMap.mockResolvedValue({ destroy: vi.fn() })
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
    const app = useVault([
      { path: 'Attachments/Screenshot Feed 2026-09-05 12-00-00.png', content: '' },
    ])
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

describe('a map tool that answered', () => {
  it('draws the map under the call, from what the tool handed back', async () => {
    const wrapper = render({
      role: 'tool-call',
      toolName: 'route',
      toolStatus: 'approved',
      toolResult: '**Drive** — 8.3 km',
      toolMap: { points: [{ lat: 56.9496, lon: 24.1052, label: 'Rīgas Doms' }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.find('.abele-chat-msg__map').exists()).toBe(true)
    expect(wrapper.find('.abele-map').exists()).toBe(true)
    const config = renderMap.mock.calls[0]?.[1] as unknown as {
      points: Array<{ label?: string }>
      interactive: boolean
    }
    expect(config.points[0].label).toBe('Rīgas Doms')
    // The answer can be explored in place: nearby houses and establishments are clickable.
    expect(config.interactive).toBe(true)
  })

  it('shows a useful error instead of leaving an unhandled blank map', async () => {
    renderMap.mockRejectedValueOnce(new Error('WebGL is unavailable'))
    const wrapper = render({
      role: 'tool-call',
      toolName: 'route',
      toolStatus: 'approved',
      toolMap: { points: [{ lat: 56.9496, lon: 24.1052 }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.find('.abele-map-error').text()).toContain('WebGL is unavailable')
  })

  it('draws nothing for a call that carried no map', () => {
    const wrapper = render({ role: 'tool-call', toolName: 'read', toolStatus: 'approved' })

    expect(wrapper.find('.abele-map').exists()).toBe(false)
  })
})

describe('the actions a message opens from its icon', () => {
  // The icon sits beside the first line of a message. Its actions used to open below the whole
  // message, so on a long answer the icon was tapped at the top and Retry appeared a screen
  // further down. They open at the top of the body now, beside the icon that opened them.
  it('open at the top of the message, before its text', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}`).join('\n\n')
    const wrapper = render({ role: 'assistant', content: long, thinking: 'hmm' })

    await wrapper.find('.abele-chat-msg__icon').trigger('click')

    const body = wrapper.find('.abele-chat-msg__body').element
    const details = body.querySelector('.abele-chat-msg__details')
    expect(details).not.toBeNull()
    expect(body.firstElementChild).toBe(details)
  })

  it('put the buttons first, above the params and the result, which can be long', async () => {
    const wrapper = render({
      role: 'tool-call',
      toolName: 'read',
      toolParams: { path: 'a.md' },
      toolResult: 'x'.repeat(2000),
      toolStatus: 'approved',
    })

    await wrapper.find('.abele-chat-msg__icon').trigger('click')

    const details = wrapper.find('.abele-chat-msg__details').element
    const retry = [...details.querySelectorAll('.abele-chat-msg__branch-action')].find(
      (el) => el.textContent?.trim() === 'Retry',
    )
    const params = details.querySelector('pre')
    expect(retry).toBeTruthy()
    expect(params).not.toBeNull()
    expect(retry!.compareDocumentPosition(params!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('still emit retry', async () => {
    const wrapper = render({ role: 'assistant', content: 'answer' })
    await wrapper.find('.abele-chat-msg__icon').trigger('click')
    const retry = wrapper
      .findAll('.abele-chat-msg__branch-action')
      .find((w) => w.text() === 'Retry')
    await retry!.trigger('click')
    expect(wrapper.emitted('retry-message')?.[0]).toEqual(['m1'])
  })
})
