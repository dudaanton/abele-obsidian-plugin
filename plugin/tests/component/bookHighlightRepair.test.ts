import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu, type MenuItem } from 'obsidian'
import BookSelectionBar from '@/components/reader/BookSelectionBar.vue'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(() => vi.restoreAllMocks())

const highlight = {
  cfi: 'epubcfi(/6/2!/4/2:1)',
  color: 'yellow' as const,
  text: 'Invented passage.',
  comment: '',
  label: 'Sample',
}

describe('repair action on a highlight', () => {
  it('keeps the modifier click for opening a highlight note in another tab', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const bar = mount(BookSelectionBar, { props: { highlight } })
    await bar.find('.abele-book-selection__more').trigger('click', { metaKey: true })
    const menu = show.mock.contexts[0] as unknown as {
      items: { title: string; handler: () => void }[]
    }
    menu.items.find((item) => item.title === 'Open the highlights note')!.handler()
    expect(bar.emitted('open-note')?.[0]?.[0]).toMatchObject({ metaKey: true })
  })

  it('does not appear for an agreeing highlight or a fresh selection', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    for (const props of [
      { highlight, repairCount: 2 },
      { highlight: null, repairable: true, repairCount: 2 },
    ]) {
      const bar = mount(BookSelectionBar, { props })
      show.mockClear()
      await bar.find('.abele-book-selection__more').trigger('click')
      const menu = show.mock.contexts[0] as unknown as { items: { title: string }[] }
      expect(menu.items.filter((item) => item.title.startsWith('Repair'))).toEqual([])
      bar.unmount()
    }
  })

  it('offers one or all known links in a native menu, but does not write on opening', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const bar = mount(BookSelectionBar, { props: { highlight, repairable: true, repairCount: 3 } })
    await bar.find('.abele-book-selection__more').trigger('click')
    expect(bar.emitted('repair')).toBeUndefined()
    const menu = show.mock.contexts[0] as unknown as { items: MenuItem[] }
    const items = (menu.items as unknown as { title: string; handler: () => void }[]).filter(
      (item) => item.title.startsWith('Repair')
    )
    expect(items.map((i) => i.title)).toEqual([
      'Repair this highlight link…',
      'Repair all found links (3)…',
    ])
    items[0].handler()
    items[1].handler()
    expect(bar.emitted('repair')).toEqual([[false], [true]])
    await bar.setProps({ repairCount: 1 })
    await bar.find('.abele-book-selection__more').trigger('click')
    expect(
      (show.mock.contexts[1] as unknown as { items: MenuItem[] }).items.filter((item) =>
        (item as unknown as { title: string }).title.startsWith('Repair')
      )
    ).toHaveLength(1)
  })
})
