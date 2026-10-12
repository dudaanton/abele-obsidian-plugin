/**
 * Scripts in the reader selection menu, with a way to pick any other script.
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
  it.each([1, 2, 4])('keeps %i pinned scripts and the picker in More', async (count) => {
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const scripts = Array.from({ length: count }, (_, i) => item(`Sample ${i}`, `Action ${i}`))
    const bar = mount(BookSelectionBar, { props: { scripts, canRunScripts: true } })
    expect(bar.findAll('.abele-book-selection__actions .abele-obsidian-icon')).toHaveLength(3)
    await bar.find('.abele-book-selection__more').trigger('click')
    const menu = show.mock.contexts[0] as unknown as {
      items: { title: string; section: string; handler: () => void }[]
    }
    const entries = menu.items.filter((entry) => entry.section === 'scripts')
    expect(entries.map((entry) => entry.title)).toEqual([
      ...scripts.map((script) => `Run ${script.label}`),
      'Run a script…',
    ])
    expect(bar.emitted('script')).toBeUndefined()
    entries[0].handler()
    entries[count].handler()
    expect(bar.emitted('script')).toEqual([['Sample 0'], []])
  })

  it('lists every pinned script in order before the script picker', async () => {
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
    await bar.find('.abele-book-selection__more').trigger('click')
    const shown = show.mock.contexts[0] as unknown as { items: MenuItem[] }
    const items = shown.items as unknown as {
      title: string
      handler: () => void
    }[]
    expect(items.map((i) => i.title)).toEqual([
      'Read aloud from here',
      'Copy a link to this place',
      'Quote into the last note',
      'Run A',
      'Run B',
      'Run See',
      'Run D',
      'Run a script…',
    ])
    items[5].handler()
    items[7].handler()
    expect(bar.emitted('script')).toEqual([['C'], []])
  })

  it('shows none without scripts', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const bar = mount(BookSelectionBar, { props: { highlight: null } })
    expect(bar.find('.abele-book-selection__run-script').exists()).toBe(false)
    expect(bar.find('.abele-book-selection__script').exists()).toBe(false)
    expect(bar.find('.abele-book-selection__scripts').exists()).toBe(false)
    await bar.find('.abele-book-selection__more').trigger('click')
    const menu = show.mock.contexts[0] as unknown as { items: { section: string }[] }
    expect(menu.items.filter((item) => item.section === 'scripts')).toEqual([])
  })
})
