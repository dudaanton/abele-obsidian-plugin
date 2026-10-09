import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import ListRow from '@/components/obsidian/ListRow.vue'
import Disclosure from '@/components/obsidian/Disclosure.vue'
import RelativeTime from '@/components/obsidian/RelativeTime.vue'
import PathLabel from '@/components/obsidian/PathLabel.vue'
import Quote from '@/components/obsidian/Quote.vue'
import EventList from '@/components/obsidian/EventList.vue'
import SwatchPicker from '@/components/obsidian/SwatchPicker.vue'
import TreeItem from '@/components/obsidian/TreeItem.vue'
import Icon from '@/components/obsidian/Icon.vue'

describe('native row composition', () => {
  it('uses host row anatomy and shares the main hit region with noninteractive facts', async () => {
    const row = mount(ListRow, {
      props: {
        title: 'sample.md',
        icon: 'file-text',
        interactive: true,
        facts: [{ key: 'where', value: 'Work' }],
      },
      slots: {
        actions: () =>
          h(Icon, { icon: 'ellipsis', tooltip: 'More file actions', interactive: true }),
        detail: 'Saved source',
      },
    })
    expect(row.find('.tree-item-self .tree-item-inner').exists()).toBe(true)
    expect(row.get('.abele-list-row__main').text()).toContain('Work')
    expect(row.get('.abele-list-row__main').find('button, summary, input').exists()).toBe(false)
    expect(row.get('.abele-list-row__content').text()).toContain('Saved source')
    await row.get('.abele-list-row__actions button').trigger('click')
    expect(row.emitted('open')).toBeUndefined()
  })
  it('keeps the meaningful file extension separate from a clamped basename', () => {
    const row = mount(ListRow, {
      props: { title: 'A long sample document name.md', preserveExtension: true },
    })
    expect(row.get('.abele-list-row__extension').text()).toBe('.md')
    expect(row.get('.abele-list-row__title-text').text()).not.toContain('.md')
  })
  it('requests far-edge detail expansion independently of the object action', async () => {
    const row = mount(ListRow, {
      props: {
        title: 'sample.md',
        interactive: true,
        expanded: false,
        detailsLabel: 'Sources',
        detailsCount: 2,
      },
    })
    await row.get('[aria-label="Sources 2"]').trigger('click')
    expect(row.emitted('update:expanded')).toEqual([[true]])
    expect(row.emitted('open')).toBeUndefined()
  })
  it('clears a removed glyph while retaining the alignment gutter', async () => {
    const row = mount(TreeItem, { props: { text: 'sample.md', icon: 'file-text' } })
    // setIcon's unit stand-in supplies attributes only; the host supplies SVG children.
    row
      .get('.abele-tree-item__glyph')
      .element.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    await row.setProps({ icon: undefined })
    expect(row.get('.abele-tree-item__glyph').element.childElementCount).toBe(0)
  })
  it('reserves a native icon gutter for iconless tree siblings', () => {
    const plain = mount(TreeItem, { props: { text: 'sample.md', plain: true } })
    expect(plain.find('.abele-tree-item__glyph').exists()).toBe(true)
  })
})
describe('subordinate detail', () => {
  it('can keep a labelled native disclosure at the row edge without repeating its label', () => {
    const view = mount(Disclosure, {
      props: { label: 'Sources', count: 2, modelValue: false, compact: true },
    })
    expect(view.get('button').attributes('aria-label')).toBe('Sources 2')
    expect(view.get('button').text()).toBe('')
    expect(view.find('.collapse-icon').exists()).toBe(true)
  })
  it('puts exact time in its own block while retaining the semantic relative label', () => {
    const view = mount(RelativeTime, {
      props: {
        value: '2026-04-05T10:15:00Z',
        now: new Date('2026-04-05T12:00:00Z'),
        timeZone: 'UTC',
      },
    })
    expect(view.get('.abele-relative-time__exact').text()).toBe('05.04.2026, 10:15')
    expect(view.get('summary .collapse-icon').exists()).toBe(true)
  })
  it('uses the host collapse glyph for full path access, not the browser marker', () => {
    const view = mount(PathLabel, { props: { path: 'Work/sample.md' } })
    expect(view.get('summary .collapse-icon').exists()).toBe(true)
  })
  it('does not present empty-state copy as a quotation from the document', () => {
    const view = mount(Quote, { props: { text: '' } })
    expect(view.find('blockquote').exists()).toBe(false)
    expect(view.text()).toContain('No quoted text')
  })
})
describe('honest operation state', () => {
  it('keeps identity, names pending save accurately and omits nonexistent historical time', () => {
    const view = mount(EventList, {
      props: {
        events: [{ id: 'pending', title: 'sample.md', state: 'pending', source: 'Discussion' }],
      },
    })
    expect(view.text()).toContain('sample.md')
    expect(view.text()).toContain('Saving')
    expect(view.text()).not.toContain('Refreshing')
    expect(view.text()).not.toContain('Time unknown')
  })
  it('shows a single unavailable explanation and an explicit retry operation', async () => {
    const view = mount(EventList, {
      props: {
        events: [
          { id: 'missing', title: 'sample.md', state: 'missing' },
          {
            id: 'retry',
            title: 'draft.md',
            state: 'error',
            retryable: true,
            retryLabel: 'Retry save',
          },
        ],
      },
    })
    expect(view.text()).not.toContain('Object unavailable')
    await view.get('[aria-label="Retry save"]').trigger('click')
    expect(view.emitted('retry')).toEqual([['retry']])
  })
  it('distinguishes no colour and exposes underline selection visually as well as programmatically', () => {
    const view = mount(SwatchPicker, {
      props: { modelValue: 'grey', label: 'Colour', colors: ['grey', 'yellow'], underline: true },
    })
    expect(view.get('[aria-label="Grey"]').find('.abele-swatch-picker__clear').exists()).toBe(true)
    expect(view.get('[role="checkbox"]').classes()).toContain('is-active')
  })
})
