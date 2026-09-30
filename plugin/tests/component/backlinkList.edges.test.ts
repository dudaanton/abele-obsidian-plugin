process.env.TZ = 'Europe/Berlin'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import dayjs from 'dayjs'
import NotesList from '@/components/NotesList.vue'
import Card from '@/components/obsidian/Card.vue'
import { Note } from '@/entities/Note'
import { FOOTER_FOLD, resetFooterFolds } from '@/composables/useFooterFold'
import { FOOTER_VIEW_KEY, resetFooterView } from '@/composables/useFooterView'
import { configureAbele, useVault } from '../helpers/testEnv'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

const make = (name: string, created?: string, updated?: string) =>
  Object.assign(new Note(`Notes/${name}.md`), {
    createdAt: created ? dayjs(created) : null,
    updatedAt: updated ? dayjs(updated) : null,
  })

describe('backlink list — ordering, metadata and restored pages', () => {
  let view: VueWrapper | undefined
  let app: ReturnType<typeof useVault>
  const render = (notes: Note[], footer = false) => {
    view = mount(NotesList, {
      props: { notes },
      global: { provide: footer ? { [FOOTER_FOLD as symbol]: () => 'Groups/Orchard.md' } : {} },
    })
    return view
  }
  const titles = () => view!.findAllComponents(Card).map((c) => c.props('title'))

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2028-03-01T00:30:00+01:00'))
    app = useVault([{ path: 'Media/sample.png' }])
    configureAbele().rememberNotePlaces = true
    resetFooterFolds()
    resetFooterView()
    resetFakeIntersectionObservers()
    installFakeIntersectionObserver()
  })
  afterEach(() => {
    view?.unmount()
    resetFooterFolds()
    resetFooterView()
    resetFakeIntersectionObservers()
    vi.useRealTimers()
  })

  it('sorts newest first, preserves ties, treats missing dates as zero and never mutates props', async () => {
    const notes = [
      make('Undated'),
      make('Old', '2027-12-31', '2028-03-01'),
      make('New', '2028-02-29'),
      make('Tie', '2028-02-29'),
    ]
    const before = [...notes]
    const v = render(notes)
    expect(titles()).toEqual(['New', 'Tie', 'Old', 'Undated'])
    await v.find('button').trigger('click')
    expect(titles()).toEqual(['Old', 'New', 'Tie', 'Undated'])
    expect(v.find('button').text()).toBe('updated')
    await v.find('button').trigger('click')
    expect(titles()).toEqual(['New', 'Tie', 'Old', 'Undated'])
    expect(notes).toEqual(before)
  })

  it('renders only distinct local days, including updated-only and previous-year dates', () => {
    const v = render([
      make('Boundary', '2028-02-29T23:00:00+01:00', '2028-02-29T23:10:00Z'),
      make('Same', '2028-02-29T10:00:00+01:00', '2028-02-29T21:00:00Z'),
      make('Prior year', '2027-12-31'),
      make('Updated only', undefined, '2028-03-01'),
    ])
    expect(v.findAllComponents(Card).map((c) => c.props('meta'))).toEqual([
      ['29.02', 'updated 01.03'],
      ['29.02'],
      ['31.12.2027'],
      ['updated 01.03'],
    ])
    expect(v.find('[data-abele-anchor="note:Notes/Boundary.md"]').exists()).toBe(true)
    expect(v.attributes('data-abele-anchor')).toBe('section:backlinks')
  })

  it('restores pages, resolves covers only for mounted cards, and resets pages on sort', async () => {
    const notes = Array.from({ length: 151 }, (_, i) =>
      Object.assign(make(`Row ${i}`), { cover: 'sample.png' })
    )
    app.saveLocalStorage(FOOTER_VIEW_KEY, { 'Groups/Orchard.md': { pages: { backlinks: 2 } } })
    const v = render(notes, true)
    expect(titles()).toHaveLength(100)
    expect(app.stats.getFirstLinkpathDest).toBe(100)
    expect(app.stats.read).toBe(0)
    await nextTick()
    expect(scrollIntoView(v.find('.abele-notes-list__sentinel').element)).toBe(1)
    await nextTick()
    expect(titles()).toHaveLength(150)
    await v.find('.abele-notes-list__sort-btn').trigger('click')
    expect(titles()).toHaveLength(50)
    expect(app.loadLocalStorage(FOOTER_VIEW_KEY)).toEqual({})
  })

  it('updates the empty state and observer as a list empties and refills', async () => {
    const v = render([])
    expect(v.text()).toContain('No notes to show.')
    expect(v.find('.abele-notes-list__sentinel').exists()).toBe(false)
    await v.setProps({ notes: Array.from({ length: 51 }, (_, i) => make(`Row ${i}`)) })
    expect(titles()).toHaveLength(50)
    await nextTick()
    expect(scrollIntoView(v.find('.abele-notes-list__sentinel').element)).toBe(1)
    await nextTick()
    expect(titles()).toHaveLength(51)
    expect(v.find('.abele-notes-list__sentinel').exists()).toBe(false)
    await v.setProps({ notes: [] })
    expect(titles()).toEqual([])
    expect(v.text()).toContain('No notes to show.')
  })
})
