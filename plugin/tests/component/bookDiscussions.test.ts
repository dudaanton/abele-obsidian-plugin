/**
 * Discussions in the reader's panel and bar: listed with the highlights, a way into each chat,
 * a choice of which kind to see, and "Ask here" on a discussion saying it opens it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import BookHighlights from '@/components/reader/BookHighlights.vue'
import BookSelectionBar from '@/components/reader/BookSelectionBar.vue'
import type { Highlight } from '@/reader/highlights'
import { useVault } from '../helpers/testEnv'

const h = (over: Partial<Highlight>): Highlight => ({
  cfi: 'epubcfi(/6/8!/4/2,/1:0,/1:5)',
  color: 'yellow',
  text: 'Words',
  comment: '',
  label: 'Chapter 3',
  ...over,
})

const list = [
  h({ cfi: 'a', text: 'Only highlighted', color: 'green' }),
  h({ cfi: 'b', text: 'Only asked about', discussion: 'k7d2ph', plain: true }),
  h({ cfi: 'c', text: 'Highlighted and asked about', color: 'blue', discussion: '3mq0xa' }),
]

beforeEach(() => useVault([]))

describe('discussions in the highlights panel', () => {
  it('are listed with the highlights, each with a way into its chat', async () => {
    const view = mount(BookHighlights, { props: { highlights: list } })
    const items = view.findAll('.abele-book-highlights__item')
    expect(items.map((i) => i.find('.abele-book-highlights__text').text())).toEqual([
      'Only highlighted',
      'Only asked about',
      'Highlighted and asked about',
    ])
    expect(items[1].classes()).toContain('abele-book-highlights__item_discussion')
    expect(items[0].find('.abele-book-highlights__label .abele-obsidian-icon').exists()).toBe(false)
    await items[1].find('.abele-book-highlights__label .abele-obsidian-icon').trigger('click')
    expect(view.emitted('discuss')).toEqual([[list[1]]])
    // Opening the chat is not going to the place as well.
    expect(view.emitted('go')).toBeUndefined()
  })

  it('shows only the discussions, or only the highlights, when asked', async () => {
    const view = mount(BookHighlights, { props: { highlights: list } })
    const select = view.find('.abele-book-highlights__filter select')
    await select.setValue('discussions')
    expect(view.findAll('.abele-book-highlights__text').map((t) => t.text())).toEqual([
      'Only asked about',
      'Highlighted and asked about',
    ])
    await select.setValue('highlights')
    expect(view.findAll('.abele-book-highlights__text').map((t) => t.text())).toEqual([
      'Only highlighted',
      'Highlighted and asked about',
    ])
  })

  it('offers no choice where there is no discussion', () => {
    const view = mount(BookHighlights, { props: { highlights: [list[0]] } })
    expect(view.find('.abele-book-highlights__filter').exists()).toBe(false)
  })
})

describe('Ask here on the bar', () => {
  it('starts a discussion on words, and opens the one a highlight already has', () => {
    const plain = mount(BookSelectionBar, { props: { highlight: null, canAsk: true } })
    expect(plain.find('[aria-label^="Ask the agent about these words"]').exists()).toBe(true)
    const talked = mount(BookSelectionBar, { props: { highlight: list[2], canAsk: true } })
    expect(talked.find('[aria-label="Open the discussion about these words"]').exists()).toBe(true)
  })
})
