/**
 * Replies in the chat's messages: an answer of the agent can be replied to, whole or by its
 * selected words, and a sent question shows each place it replies to as a chip where the person
 * put it, between their own words, each the way back to its words.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { Menu } from 'obsidian'
import AiChatMessage from '@/components/AiChatMessage.vue'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))

const answer = {
  id: 'answer',
  role: 'assistant' as const,
  content: 'Keep the lamp low.',
  timestamp: 1,
}

const question = {
  id: 'question',
  role: 'user' as const,
  content: 'How low? And still so?',
  timestamp: 2,
  replyTo: [
    { messageId: 'answer', quote: 'the lamp low', start: 5, at: 0 },
    { messageId: 'elsewhere', quote: 'An older answer.', at: 9 },
  ],
}

describe('a sent question with places', () => {
  it('shows each place as a chip where it stood, the words between them', async () => {
    const wrapper = mount(AiChatMessage, {
      attachTo: document.body,
      props: { message: question, replyGone: ['elsewhere'] },
    })
    await flushPromises()
    const content = wrapper.get('[data-find-part="content"]').element
    const chips = Array.from(content.querySelectorAll<HTMLElement>('.abele-reply-chip'))
    expect(chips.map((c) => c.textContent)).toEqual(['1the lamp low', '2An older answer.'])
    // In the line of words: chip, the words, chip, the words.
    const line = Array.from(chips[0].parentElement!.childNodes).map((n) =>
      n instanceof HTMLElement ? `[${n.dataset.replySpot}]` : n.textContent
    )
    expect(line).toEqual(['[0]', 'How low? ', '[1]', 'And still so?'])
    expect(content.textContent).not.toContain('')

    chips[0].click()
    expect(wrapper.emitted('show-reply')).toEqual([[question.replyTo[0]]])
    // Its message is in another branch: the chip stays, faint, and leads nowhere.
    expect(chips[1].classList).toContain('abele-reply-chip_gone')
    expect(chips[1].querySelector('[data-icon="unlink"]')).not.toBeNull()
    chips[1].click()
    expect(wrapper.emitted('show-reply')).toHaveLength(1)
    wrapper.unmount()
  })

  it('draws a chip again when its message comes back into the branch', async () => {
    const wrapper = mount(AiChatMessage, {
      attachTo: document.body,
      props: { message: question, replyGone: ['elsewhere'] },
    })
    await flushPromises()
    await wrapper.setProps({ replyGone: [] })
    const chips = wrapper.findAll('.abele-reply-chip')
    expect(chips).toHaveLength(2)
    expect(chips[1].classes()).not.toContain('abele-reply-chip_gone')
    wrapper.unmount()
  })

  it('shows a question that is only a place', async () => {
    const wrapper = mount(AiChatMessage, {
      props: {
        message: { ...question, content: '', replyTo: [question.replyTo[0]] },
      },
    })
    await flushPromises()
    const chip = wrapper.get('.abele-reply-chip')
    expect(chip.find('.abele-reply-chip__number').exists()).toBe(false)
    expect(chip.text()).toBe('the lamp low')
    wrapper.unmount()
  })

  it('renders a question written before places as it always did', async () => {
    const wrapper = mount(AiChatMessage, {
      props: {
        message: { id: 'q', role: 'user', content: '> Quoted words\n\nMine.', timestamp: 1 },
      },
    })
    await flushPromises()
    expect(wrapper.get('[data-find-part="content"]').text()).toContain('Quoted words')
    expect(wrapper.find('.abele-reply-chip').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('replying to an answer', () => {
  it('replies to the whole answer from its line, by its words as they read', async () => {
    const wrapper = mount(AiChatMessage, {
      attachTo: document.body,
      props: { message: answer, canReply: true, canComment: true },
    })
    await flushPromises()
    await wrapper.get('[aria-label="Reply to this"]').trigger('click')
    expect(wrapper.emitted('reply')).toEqual([
      [{ messageId: 'answer', quote: 'Keep the lamp low.' }],
    ])
    wrapper.unmount()
  })

  it('offers Reply before Ask here in the menu of selected words', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const wrapper = mount(AiChatMessage, {
      attachTo: document.body,
      props: { message: answer, canReply: true, canComment: true },
    })
    await flushPromises()
    const root = wrapper.get('[data-ask-message]').element
    const range = document.createRange()
    range.selectNodeContents(root)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    await wrapper.get('[data-ask-message]').trigger('contextmenu')
    const menu = show.mock.instances.at(-1)!
    expect(menu.items.map((item) => item.title).slice(0, 3)).toEqual(['Copy', 'Reply', 'Ask here'])
    menu.items[1].handler!()
    expect(wrapper.emitted('reply')).toEqual([
      [{ messageId: 'answer', quote: 'Keep the lamp low.', start: 0 }],
    ])
    document.getSelection()!.removeAllRanges()
    wrapper.unmount()
    show.mockRestore()
  })

  it('offers only Copy and Reply where nothing can be kept about the words', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const wrapper = mount(AiChatMessage, {
      attachTo: document.body,
      props: { message: answer, canReply: true, readOnlyHistory: true },
    })
    await flushPromises()
    const root = wrapper.get('[data-find-part="content"]').element
    const range = document.createRange()
    range.selectNodeContents(root)
    document.getSelection()!.addRange(range)
    await wrapper.get('[data-find-part="content"]').trigger('contextmenu')
    expect(show.mock.instances.at(-1)!.items.map((item) => item.title)).toEqual(['Copy', 'Reply'])
    // A history that cannot be changed is still one the next message can reply to.
    expect(wrapper.find('[aria-label="Reply to this"]').exists()).toBe(true)
    document.getSelection()!.removeAllRanges()
    wrapper.unmount()
    show.mockRestore()
  })

  it('gives no Reply on a question of the person, nor where nothing can be written', async () => {
    const own = mount(AiChatMessage, {
      props: { message: { id: 'q', role: 'user', content: 'Why?', timestamp: 1 }, canReply: true },
    })
    await flushPromises()
    expect(own.find('[aria-label="Reply to this"]').exists()).toBe(false)
    own.unmount()
    const run = mount(AiChatMessage, { props: { message: answer } })
    await flushPromises()
    expect(run.find('[aria-label="Reply to this"]').exists()).toBe(false)
    run.unmount()
  })
})
