/**
 * The list beside the history timeline: for a life, who lived at the same time and how many
 * years, most first; for an event, who was alive then and how old; a row picks that note, the
 * button opens the picked one, the cross lets go.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TimelinePanel from '@/components/timelineBase/TimelinePanel.vue'
import { toTimelineItem, type RawTimelineEntry, type TimelineItem } from '@/bases/timelineLayout'

const OPTS = { approx: 5, now: 2026.7 }
const item = (title: string, over: Partial<RawTimelineEntry>): TimelineItem =>
  toTimelineItem(
    {
      path: `History/${title}.md`,
      title,
      start: null,
      end: null,
      period: null,
      kind: null,
      born: true,
      era: false,
      lane: 0,
      color: 'pink',
      weight: 0,
      cover: null,
      ...over,
    },
    OPTS
  )!

const shakespeare = item('Shakespeare', { start: 1564, end: 1616 })
const galileo = item('Galileo', { start: 1564, end: 1642, color: 'cyan' })
const kepler = item('Kepler', { start: 1571, end: 1630 })
const dante = item('Dante', { start: 1265, end: 1321 })
const armada = item('Armada', { start: 1588, born: false })
const items = [shakespeare, galileo, kepler, dante, armada]

const names = (w: ReturnType<typeof mount>) =>
  w
    .findAll('.abele-timeline-panel__row')
    .map((r) => [
      r.find('.abele-timeline-panel__name').text(),
      r.find('.abele-timeline-panel__together').text(),
    ])

describe('the list of contemporaries', () => {
  it('lists who lived at the same time, most years first, and not who did not', () => {
    const w = mount(TimelinePanel, { props: { selected: shakespeare, items, lang: 'en' } })
    expect(w.find('.abele-timeline-panel__title').text()).toBe('Shakespeare')
    expect(w.find('.abele-timeline-panel__dates').text()).toBe('1564–1616 · 52 years')
    expect(names(w)).toEqual([
      ['Galileo', '52 years'],
      ['Kepler', '45 years'],
    ])
    expect(w.find('.abele-timeline-panel__caption').text()).toMatch(/^Contemporaries: 2\./)
    expect(w.find('.abele-timeline-panel__dot_cyan').exists()).toBe(true)
  })

  it('lists who was alive at an event, with their age', () => {
    const w = mount(TimelinePanel, { props: { selected: armada, items, lang: 'en' } })
    expect(names(w)).toEqual([
      ['Shakespeare', 'aged 24'],
      ['Galileo', 'aged 24'],
      ['Kepler', 'aged 17'],
    ])
  })

  it('picks a row, opens the picked note, lets go', async () => {
    const w = mount(TimelinePanel, { props: { selected: shakespeare, items, lang: 'en' } })
    await w.findAll('.abele-timeline-panel__row')[1].trigger('click')
    expect(w.emitted('select')?.[0]).toEqual([kepler])
    await w.find('.abele-obsidian-button').trigger('click')
    expect(w.emitted('open')?.[0]).toEqual([shakespeare, null])
  })
})
