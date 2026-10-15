import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import dayjs from 'dayjs'
import NotesList from '@/components/NotesList.vue'
import Card from '@/components/obsidian/Card.vue'
import Search from '@/components/obsidian/Search.vue'
import { Note } from '@/entities/Note'
import { resetFooterFolds } from '@/composables/useFooterFold'
import { resetFooterView } from '@/composables/useFooterView'
import { SEARCH_DELAY_MS } from '@/composables/useListSearch'
import { configureAbele, useVault } from '../helpers/testEnv'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

const note = (name: string, day: number, description: string | null = null) =>
  Object.assign(new Note(`Notes/${name}.md`), {
    createdAt: dayjs('2028-01-01').add(day, 'day'),
    description,
  })

describe('backlink list — search, as the log list has it', () => {
  let view: VueWrapper | undefined
  let app: ReturnType<typeof useVault>
  const titles = () => view!.findAllComponents(Card).map((c) => c.props('title'))
  const type = async (query: string) => {
    view!.findComponent(Search).vm.$emit('update:modelValue', query)
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS)
    await flushPromises()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    resetFooterFolds()
    resetFooterView()
    resetFakeIntersectionObservers()
    installFakeIntersectionObserver()
    configureAbele()
  })
  afterEach(() => {
    view?.unmount()
    resetFakeIntersectionObservers()
    vi.useRealTimers()
  })

  it('opens the same field from the same glyph and narrows by name and note text', async () => {
    app = useVault([
      { path: 'Notes/Apple orchard.md', content: 'Planted in spring.' },
      { path: 'Notes/Pear trees.md', content: 'Pruned the old apple tree too.' },
      { path: 'Notes/Fence.md', content: 'Painted it green.', frontmatter: { kind: 'apple' } },
    ])
    view = mount(NotesList, {
      props: {
        notes: [note('Apple orchard', 3), note('Pear trees', 2), note('Fence', 1)],
      },
    })
    const toggle = view.find('.abele-notes-list__search-toggle')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-label')).toBe('Search backlinks by name and text')
    await toggle.trigger('click')
    const field = view.findComponent(Search)
    expect(field.exists()).toBe(true)
    expect(field.props('placeholder')).toBe('Search backlinks…')
    await flushPromises()
    expect(app.stats.read).toBe(3)

    // Every word, any case, in the name or the body — never the properties.
    await type('APPLE')
    expect(titles()).toEqual(['Apple orchard', 'Pear trees'])
    await type('apple pruned')
    expect(titles()).toEqual(['Pear trees'])
    await type('spring orchard')
    expect(titles()).toEqual(['Apple orchard'])

    await type('nowhere')
    expect(titles()).toEqual([])
    expect(view.find('.abele-notes-list__no-notes').text()).toBe('Nothing matches the search.')
    expect(view.find('.abele-notes-list__sentinel').exists()).toBe(false)

    // Escape closes it and brings the whole list back.
    await field.trigger('keydown', { key: 'Escape' })
    expect(view.findComponent(Search).exists()).toBe(false)
    expect(titles()).toEqual(['Apple orchard', 'Pear trees', 'Fence'])
  })

  it('answers from the description while a note is still unread', async () => {
    app = useVault([])
    view = mount(NotesList, { props: { notes: [note('Barn', 1, 'Red roof'), note('Shed', 0)] } })
    await view.find('.abele-notes-list__search-toggle').trigger('click')
    await type('roof')
    expect(titles()).toEqual(['Barn'])
  })

  it('reaches a note sorted far past the first page and gives the pages back on close', async () => {
    const many = Array.from({ length: 120 }, (_, i) => note(`Row ${i}`, i))
    app = useVault(many.map((n, i) => ({ path: n.filePath, content: i === 0 ? 'Needle' : 'Hay' })))
    view = mount(NotesList, { props: { notes: many } })
    expect(titles()).toHaveLength(50)
    await nextTick()
    expect(scrollIntoView(view.find('.abele-notes-list__sentinel').element)).toBe(1)
    await nextTick()
    expect(titles()).toHaveLength(100)
    await view.find('.abele-notes-list__search-toggle').trigger('click')
    await type('needle')
    expect(titles()).toEqual(['Row 0'])
    await view.find('.abele-notes-list__search-toggle').trigger('click')
    expect(titles()).toHaveLength(100)
  })
})
