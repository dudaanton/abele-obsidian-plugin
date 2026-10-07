import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu } from 'obsidian'
import AiChatMessage from '@/components/AiChatMessage.vue'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
const render = (role: ChatMessage['role'], props = {}) =>
  mount(AiChatMessage, {
    props: {
      message: { id: 'sample-message', role, content: 'Sample words', timestamp: 1 },
      canClone: true,
      ...props,
    },
  })

describe('message action controls', () => {
  it('opens from a keyboard-reachable button and exposes frequent actions with icons', async () => {
    const wrapper = render('user')
    const toggle = wrapper.get('button.abele-chat-msg__icon')
    expect(toggle.attributes('aria-label')).toBe('Message actions and details')
    await toggle.trigger('click')
    const buttons = wrapper.findAll('.abele-chat-msg__actions button')
    expect(buttons.map((b) => b.attributes('aria-label'))).toEqual([
      'Copy message',
      'Edit',
      'Insert into note',
      'More message actions',
    ])
    expect(buttons.every((b) => b.find('.abele-obsidian-icon').exists())).toBe(true)
    await buttons[1].trigger('click')
    expect(wrapper.emitted('edit-message')?.[0]).toEqual(['sample-message'])
    wrapper.unmount()
  })

  it('keeps every less frequent action reachable in a grouped native menu', async () => {
    const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
    const wrapper = render('user', { canRewind: true, changedFiles: true })
    await wrapper.get('.abele-chat-msg__icon').trigger('click')
    await wrapper.get('[aria-label="More message actions"]').trigger('click')
    const menu = shown.mock.contexts.at(-1) as Menu
    expect(menu.items.map((item) => [item.title, item.section])).toEqual([
      ['Repeat', 'message'],
      ['Branch from here', 'conversation'],
      ['New chat from here', 'conversation'],
      ['Rewind', 'changes'],
      ['Undo changes', 'changes'],
    ])
    expect(menu.items.every((item) => item.icon)).toBe(true)
    for (const item of menu.items) item.handler!()
    expect(wrapper.emitted('repeat-message')?.[0]).toEqual(['sample-message'])
    expect(wrapper.emitted('create-branch')?.[0]).toEqual(['sample-message'])
    expect(wrapper.emitted('clone-chat')?.[0]).toEqual(['sample-message'])
    expect(wrapper.emitted('rewind')).toEqual([
      ['sample-message', 'since'],
      ['sample-message', 'turn'],
    ])
    wrapper.unmount()
  })

  it('does not offer a clone for node histories or drafts', async () => {
    const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
    const wrapper = render('assistant', { canClone: false })
    await wrapper.get('.abele-chat-msg__icon').trigger('click')
    await wrapper.get('[aria-label="More message actions"]').trigger('click')
    expect((shown.mock.contexts.at(-1) as Menu).items.map((i) => i.title)).not.toContain(
      'New chat from here'
    )
    await wrapper.setProps({ readOnlyHistory: true })
    expect(wrapper.find('[aria-label="More message actions"]').exists()).toBe(false)
    await wrapper.setProps({
      readOnlyHistory: false,
      canClone: true,
      message: { id: 'draft', role: 'user', content: 'Unsent', timestamp: 1, draft: true },
    })
    await wrapper.get('[aria-label="More message actions"]').trigger('click')
    expect((shown.mock.contexts.at(-1) as Menu).items.map((i) => i.title)).not.toContain(
      'New chat from here'
    )
    wrapper.unmount()
  })
})
