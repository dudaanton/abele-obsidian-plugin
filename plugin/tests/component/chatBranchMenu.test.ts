/**
 * The count on a branch switch opens Obsidian's menu, one item per branch: how it starts, then
 * its facts as quiet codes — questions, time, and a dot when something there wants you. Each
 * item's title is the kit's `ChatBranchTitle`, rendered before the menu measures itself and
 * taken out again when the menu closes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu, type MenuItem } from 'obsidian'
import ChatBranchSwitch from '@/components/ChatBranchSwitch.vue'
import type { BranchChoice } from '@/ai/chatBranches'

const choices: BranchChoice[] = [
  {
    id: 'a',
    title: 'Plan the sample garden',
    timestamp: Date.UTC(2020, 0, 2, 9, 30),
    questions: 3,
  },
  {
    id: 'b',
    title: 'Plan it with raised beds',
    timestamp: Date.UTC(2020, 0, 2, 10, 15),
    questions: 1,
    tone: 'waiting',
  },
]

const show = vi.spyOn(Menu.prototype, 'showAtPosition')

/** The menu the switch placed last: the `this` of its `showAtPosition` call. */
const shownMenu = () => (show.mock.contexts.at(-1) as Menu | undefined) ?? null

afterEach(() => {
  show.mockClear()
})

/** What the menu item's title holds once Obsidian has moved the fragment into it. */
const titleOf = (item: MenuItem) => {
  const el = document.createElement('div')
  el.append(item.title as unknown as DocumentFragment)
  return el
}

async function openMenu() {
  const wrapper = mount(ChatBranchSwitch, {
    props: { choices, index: 1 },
    attachTo: document.body,
  })
  await wrapper.find('.abele-chat-branch__count').trigger('click')
  const shown = shownMenu()
  expect(shown).not.toBeNull()
  return { wrapper, menu: shown!, titles: shown!.items.slice(0, 2).map(titleOf) }
}

describe('the menu of branches', () => {
  it('names each branch and lists its facts, filled before the menu is placed', async () => {
    const { wrapper, titles } = await openMenu()
    const [first, second] = titles
    expect(first.querySelector('.abele-chat-branch__title')?.textContent).toBe(
      'Plan the sample garden'
    )
    expect(first.querySelector('.abele-chat-branch__title')?.getAttribute('title')).toBe(
      'Plan the sample garden'
    )
    const questions = first.querySelector('.abele-chat-branch__questions')
    expect(questions?.textContent).toBe('3')
    expect(questions?.getAttribute('aria-label')).toBe('3 questions in it')
    expect(questions?.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe(
      'message-circle-question'
    )
    expect(first.querySelector('time')).not.toBeNull()
    expect(first.querySelector('.abele-status-dot')).toBeNull()
    const dot = second.querySelector('.abele-status-dot')
    expect(dot?.classList.contains('abele-status-dot_orange')).toBe(true)
    expect(dot?.getAttribute('aria-label')).toBe('Waiting for your approval')
    wrapper.unmount()
  })

  it('marks the branch on screen and switches to another', async () => {
    const { wrapper, menu } = await openMenu()
    expect(menu.items.map((i) => i.checked)).toEqual([false, true])
    menu.items[0].handler?.()
    expect(wrapper.emitted('switch')).toEqual([['a']])
    wrapper.unmount()
  })

  it('takes every title out when the menu closes', async () => {
    const { wrapper, menu, titles } = await openMenu()
    menu.hide()
    for (const title of titles) expect(title.textContent).toBe('')
    wrapper.unmount()
  })
})
