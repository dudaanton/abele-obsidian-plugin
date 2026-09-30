import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import dayjs from 'dayjs'
import Timeline from '@/components/Timeline.vue'
import Search from '@/components/obsidian/Search.vue'
import { Task } from '@/entities/Task'
import { configureAbele, useVault } from '../helpers/testEnv'
import {
  installFakeIntersectionObserver,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

vi.mock('@/composables/useDate', () => ({ useDate: () => ({ now: ref(dayjs('2030-06-15')) }) }))

let view: VueWrapper
const task = (name: string, date: string, done = false, due?: string) => {
  const t = new Task({ wikilink: `[[Sample/${name}]]` })
  t.loaded = true
  t.title = name
  t.date = dayjs(date)
  if (due) t.due = dayjs(due)
  if (done) t.completedAt = dayjs(date)
  return t
}
const days = () =>
  view.findAll('.abele-timeline__date-block').map((d) => d.attributes('data-abele-anchor'))
const render = (tasks: Task[]) => {
  view = mount(Timeline, { props: { tasks }, shallow: true, attachTo: document.body })
  return view
}
beforeEach(() => {
  useVault([])
  configureAbele()
  installFakeIntersectionObserver()
})
afterEach(() => view?.unmount())

describe('folded timeline history', () => {
  it('starts today and counts unfinished tasks once, even across several folded days', () => {
    render([
      task('sample-span', '2030-06-10', false, '2030-06-12'),
      task('sample-old', '2030-06-14'),
      task('sample-done', '2030-06-13', true),
      task('sample-today', '2030-06-15'),
    ])
    expect(days()).toEqual(['date:2030-06-15'])
    expect(view.find('.abele-timeline__history').text()).toContain('2 unfinished')
  })

  it('reveals the closest earlier day per upward wheel, never on a click or downward wheel', async () => {
    render([
      task('sample-a', '2030-06-13'),
      task('sample-b', '2030-06-14'),
      task('sample-c', '2030-06-15'),
    ])
    await flushPromises()
    const strip = view.find('.abele-timeline__history')
    await strip.trigger('click')
    await view.trigger('wheel', { deltaY: 80 })
    expect(days()).toEqual(['date:2030-06-15'])
    await view.trigger('wheel', { deltaY: -80 })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-14', 'date:2030-06-15'])
    expect(strip.text()).toContain('1 unfinished')
    await view.trigger('wheel', { deltaY: -80 })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-13', 'date:2030-06-14', 'date:2030-06-15'])
    expect(view.find('.abele-timeline__history').exists()).toBe(false)
  })

  it('does not reset future pages or unfold old completed-only days on a completed toggle', async () => {
    render([
      task('sample-old-done', '2020-01-01', true),
      ...Array.from({ length: 60 }, (_, i) =>
        task(`sample-${i}`, dayjs('2030-06-15').add(i, 'day').format('YYYY-MM-DD'))
      ),
    ])
    await flushPromises()
    expect(scrollIntoView(view.find('.abele-timeline__sentinel').element)).toBe(1)
    await flushPromises()
    expect(days()).toHaveLength(40)
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(days()).toHaveLength(40)
    expect(days()[0]).toBe('date:2030-06-15')
    expect(view.find('.abele-timeline__history').text()).toContain('0 unfinished')
  })

  it('keeps revealed history when completed-only days appear between it and today', async () => {
    render([
      task('sample-old', '2030-06-12'),
      task('sample-done', '2030-06-13', true),
      task('sample-today', '2030-06-15'),
    ])
    await flushPromises()
    await view.trigger('wheel', { deltaY: -80 })
    await flushPromises()
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12', 'date:2030-06-13', 'date:2030-06-15'])
  })

  it('unfolds a past-only list with an upward touch and keeps other days folded', async () => {
    render([task('sample-a', '2030-06-12'), task('sample-b', '2030-06-14')])
    await flushPromises()
    expect(days()).toEqual([])
    await view.trigger('touchstart', { touches: [{ clientY: 100 }] })
    await view.trigger('touchmove', { touches: [{ clientY: 150 }] })
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-14'])
    expect(view.find('.abele-timeline__history').text()).toContain('1 unfinished')
  })

  it('keeps a late future day mounted when new completed-only dates appear before it', async () => {
    render(
      Array.from({ length: 80 }, (_, i) =>
        task(`sample-${i}`, dayjs('2030-06-15').add(i, 'day').format('YYYY-MM-DD'), i % 2 === 1)
      )
    )
    await flushPromises()
    expect(scrollIntoView(view.find('.abele-timeline__sentinel').element)).toBe(1)
    await flushPromises()
    const last = days().at(-1)
    expect(days()).toHaveLength(40)
    await view.find('.abele-timeline__completed-toggle').trigger('click')
    await flushPromises()
    expect(days().at(-1)).toBe(last)
    expect(days()).toHaveLength(79)
  })

  it('lets a title search find a folded task', async () => {
    render([task('sample-old', '2030-06-12'), task('sample-today', '2030-06-15')])
    await view.find('.abele-timeline__search-toggle').trigger('click')
    view.findComponent(Search).vm.$emit('update:modelValue', 'sample-old')
    await new Promise((resolve) => setTimeout(resolve, 250))
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-12'])
  })
})
