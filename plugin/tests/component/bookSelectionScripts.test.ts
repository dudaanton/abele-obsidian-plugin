/**
 * Scripts on the selection bar of the book reader: a button each while they are few, one button
 * with a menu of them once they are more, and in both a way to pick any other script.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu, type MenuItem } from 'obsidian'
import BookSelectionBar from '@/components/reader/BookSelectionBar.vue'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(() => vi.restoreAllMocks())

const item = (script: string, label = script, icon = 'scroll-text') => ({ script, label, icon })

describe('scripts on the selection bar', () => {
  it('has a button for each of a few scripts and one to pick any, which say which they run', async () => {
    const bar = mount(BookSelectionBar, {
      props: {
        highlight: null,
        scripts: [item('Word card', 'Card', 'languages'), item('Translate')],
        canRunScripts: true,
      },
    })
    expect(bar.findAll('.abele-book-selection__script')).toHaveLength(2)
    expect(bar.find('[data-script="Word card"]').attributes('aria-label')).toBe(
      'Run Card on these words'
    )
    expect(bar.find('.abele-book-selection__scripts').exists()).toBe(false)
    await bar.find('[data-script="Word card"]').trigger('click')
    await bar.find('[aria-label="Run a script on these words…"]').trigger('click')
    expect(bar.emitted('script')).toEqual([['Word card'], []])
  })

  it('folds more than three into one button whose menu lists them first and any other script last', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const bar = mount(BookSelectionBar, {
      props: {
        highlight: null,
        scripts: [item('A'), item('B'), item('C', 'See'), item('D')],
        canRunScripts: true,
      },
    })
    expect(bar.find('.abele-book-selection__script').exists()).toBe(false)
    expect(bar.find('.abele-book-selection__run-script').exists()).toBe(false)
    await bar.find('.abele-book-selection__scripts').trigger('click')
    const shown = show.mock.contexts[0] as unknown as { items: MenuItem[] }
    const items = shown.items as unknown as {
      title: string
      handler: () => void
    }[]
    expect(items.map((i) => i.title)).toEqual(['A', 'B', 'See', 'D', 'Other script…'])
    items[2].handler()
    items[4].handler()
    expect(bar.emitted('script')).toEqual([['C'], []])
  })

  it('shows none without scripts', () => {
    const bar = mount(BookSelectionBar, { props: { highlight: null } })
    expect(bar.find('.abele-book-selection__run-script').exists()).toBe(false)
    expect(bar.find('.abele-book-selection__script').exists()).toBe(false)
    expect(bar.find('.abele-book-selection__scripts').exists()).toBe(false)
  })
})
