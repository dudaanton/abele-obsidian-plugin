import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu, type MenuItem } from 'obsidian'
import BookSelectionBar from '@/components/reader/BookSelectionBar.vue'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(() => vi.restoreAllMocks())

const highlight = { cfi: 'epubcfi(/6/2!/4/2:1)', color: 'yellow' as const, text: 'Invented passage.', comment: '', label: 'Sample' }

describe('repair action on a highlight', () => {
  it('does not appear for an agreeing highlight or a fresh selection', () => {
    expect(mount(BookSelectionBar, { props: { highlight, repairCount: 2 } }).find('[aria-label="Repair highlight link…"]').exists()).toBe(false)
    expect(mount(BookSelectionBar, { props: { highlight: null, repairable: true, repairCount: 2 } }).find('[aria-label="Repair highlight link…"]').exists()).toBe(false)
  })

  it('offers one or all known links in a native menu, but does not write on opening', async () => {
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const bar = mount(BookSelectionBar, { props: { highlight, repairable: true, repairCount: 3 } })
    await bar.find('[aria-label="Repair highlight link…"]').trigger('click')
    expect(bar.emitted('repair')).toBeUndefined()
    const menu = show.mock.contexts[0] as unknown as { items: MenuItem[] }
    const items = menu.items as unknown as { title: string; handler: () => void }[]
    expect(items.map((i) => i.title)).toEqual(['Repair this highlight link…', 'Repair all found highlight links (3)…'])
    items[0].handler()
    items[1].handler()
    expect(bar.emitted('repair')).toEqual([[false], [true]])
    await bar.setProps({ repairCount: 1 })
    await bar.find('[aria-label="Repair highlight link…"]').trigger('click')
    expect((show.mock.contexts[1] as unknown as { items: MenuItem[] }).items).toHaveLength(1)
  })
})
