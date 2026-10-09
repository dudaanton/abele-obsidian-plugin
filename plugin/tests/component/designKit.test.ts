import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, ref } from 'vue'
import Icon from '@/components/obsidian/Icon.vue'
import ListRow from '@/components/obsidian/ListRow.vue'
import Card from '@/components/obsidian/Card.vue'
import MetaLine from '@/components/obsidian/MetaLine.vue'
import RelativeTime from '@/components/obsidian/RelativeTime.vue'
import PathLabel from '@/components/obsidian/PathLabel.vue'
import Disclosure from '@/components/obsidian/Disclosure.vue'
import EventList from '@/components/obsidian/EventList.vue'
import SheetHeaderActions from '@/components/obsidian/SheetHeaderActions.vue'
import Quote from '@/components/obsidian/Quote.vue'
import SwatchPicker from '@/components/obsidian/SwatchPicker.vue'
import Image from '@/components/obsidian/Image.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import ListSectionHeader from '@/components/obsidian/ListSectionHeader.vue'

// happy-dom cannot prove native button key defaults or computed touch geometry: live tier does.
describe('Icon semantics', () => {
  it('infers legacy actions, but keeps decoration out of the tab order', async () => {
    const action = mount(Icon, { props: { icon: 'plus', tooltip: 'Add item', onClick: () => {} } })
    expect(action.element.tagName).toBe('BUTTON')
    expect(action.attributes('type')).toBe('button')
    expect(action.attributes('aria-label')).toBe('Add item')
    await action.trigger('click')
    expect(action.emitted('click')).toHaveLength(1)
    const decorative = mount(Icon, { props: { icon: 'folder' } })
    expect(decorative.attributes('aria-hidden')).toBe('true')
    expect(decorative.attributes('tabindex')).toBeUndefined()
    await decorative.trigger('click')
    expect(decorative.emitted('click')).toBeUndefined()
  })
  it('retains a disabled toggle with a reason and blocks activation', async () => {
    const view = mount(Icon, {
      props: {
        interactive: true,
        tooltip: 'Attach',
        disabled: true,
        disabledReason: 'File unavailable',
        active: false,
      },
    })
    expect(view.attributes('disabled')).toBeDefined()
    expect(view.attributes('aria-pressed')).toBe('false')
    expect(view.attributes('aria-label')).toContain('File unavailable')
    await view.trigger('click')
    expect(view.emitted('click')).toBeUndefined()
  })
})
describe('ListRow', () => {
  it('names a disabled main action reason without disabling valid sibling actions', async () => {
    const view = mount(ListRow, {
      props: {
        title: 'missing.md',
        interactive: true,
        disabled: true,
        disabledReason: 'File unavailable',
      },
      slots: { actions: () => h(Icon, { interactive: true, icon: 'unlink', tooltip: 'Unlink' }) },
    })
    expect(view.get('.abele-list-row__main').attributes('disabled')).toBeDefined()
    expect(view.get('.abele-list-row__main').attributes('aria-label')).toContain('File unavailable')
    await view.get('.abele-list-row__main').trigger('click')
    expect(view.emitted('open')).toBeUndefined()
    expect(view.get('.abele-list-row__actions button').attributes('disabled')).toBeUndefined()
  })
  it('isolates sibling actions from opening, and exposes controlled selection', async () => {
    const view = mount(ListRow, {
      props: { title: 'sample.md', interactive: true, selected: true },
      slots: { actions: () => h(Icon, { interactive: true, tooltip: 'Unlink', icon: 'unlink' }) },
    })
    expect(view.get('.abele-list-row__main').attributes('aria-pressed')).toBe('true')
    await view.get('.abele-list-row__actions button').trigger('click')
    expect(view.emitted('open')).toBeUndefined()
    await view.get('.abele-list-row__main').trigger('click')
    expect(view.emitted('open')).toHaveLength(1)
  })
  it.each(['missing', 'loading', 'error'] as const)(
    'retains identity and associated %s state',
    (state) => {
      const view = mount(ListRow, {
        props: { title: 'sample.md', state, message: 'Retained content' },
      })
      expect(view.text()).toContain('sample.md')
      expect(view.text()).toContain('Retained content')
      expect(view.find('button').exists()).toBe(false)
    }
  )
})
describe('MetaLine', () => {
  it('separates only present facts; preserves zero and required unknown values', () => {
    const view = mount(MetaLine, {
      props: {
        facts: [
          { key: 'empty', value: '' },
          { key: 'count', label: 'Count', value: 0 },
          { key: 'time', label: 'Time', required: true },
        ],
      },
    })
    expect(view.text()).toBe('Count: 0 · Time: Unknown')
    expect(view.findAll('.abele-meta-line__fact')).toHaveLength(2)
  })
})
describe('RelativeTime', () => {
  it('has an exact accessible value and touch-readable detail with a controlled clock', () => {
    const view = mount(RelativeTime, {
      props: {
        value: '2026-04-05T10:15:00Z',
        now: new Date('2026-04-05T12:00:00Z'),
        timeZone: 'UTC',
      },
    })
    expect(view.get('time').attributes('datetime')).toBe('2026-04-05T10:15:00.000Z')
    expect(view.get('time').text()).toContain('Today')
    expect(view.get('time').attributes('aria-label')).toContain('05.04.2026, 10:15')
    expect(view.text()).toContain('05.04.2026, 10:15')
  })
  it.each([undefined, 'bad'])('does not serialize %s as Invalid Date', (value) => {
    const view = mount(RelativeTime, { props: { value } })
    expect(view.text()).toBe('Time unknown')
    expect(view.find('time').exists()).toBe(false)
  })
})
describe('PathLabel', () => {
  it('permits noninteractive compact context when a row detail already exposes the full path', () => {
    const view = mount(PathLabel, { props: { path: 'Work/sample.md', expandable: false } })
    expect(view.text()).toBe('Work')
    expect(view.find('summary').exists()).toBe(false)
  })
  it('disambiguates duplicate basenames by context and makes the full path selectable', async () => {
    const first = mount(PathLabel, { props: { path: 'Work/Long/sample.md', mode: 'context' } })
    const second = mount(PathLabel, { props: { path: 'Archive/sample.md', mode: 'context' } })
    expect(first.text()).toContain('Work/Long')
    expect(second.text()).toContain('Archive')
    expect(first.get('summary').text()).not.toContain('sample.md')
    expect(first.get('.abele-path-label__full').text()).toBe('Work/Long/sample.md')
    const remote = mount(PathLabel, {
      props: { path: 'C:\\Work\\sample.md', mode: 'full', workspace: 'Demo node', missing: true },
    })
    expect(remote.text()).toContain('C:\\Work\\sample.md')
    expect(remote.text()).toContain('Demo node')
    expect(remote.text()).toContain('Unavailable')
  })
})
describe('Disclosure', () => {
  it('requests expansion without opening an object or losing controlled state', async () => {
    const view = mount(Disclosure, {
      props: { label: 'History', modelValue: false, count: 0 },
      slots: { default: 'Details' },
    })
    expect(view.get('button').attributes('aria-expanded')).toBe('false')
    expect(view.text()).toContain('0')
    await view.get('button').trigger('click')
    expect(view.emitted('update:modelValue')).toEqual([[true]])
    expect(view.text()).not.toContain('Details')
    await view.setProps({ modelValue: true })
    expect(view.text()).toContain('Details')
    expect(view.get('button').attributes('aria-controls')).toBe(
      view.get('.abele-disclosure__content').attributes('id')
    )
  })
})
describe('EventList', () => {
  it('preserves chronology and exposes unavailable, pending and retryable failure separately', async () => {
    const view = mount(EventList, {
      props: {
        events: [
          { id: 'a', title: 'Attached', source: 'Source unavailable', state: 'missing' },
          { id: 'b', title: 'Saving', state: 'pending' },
          { id: 'c', title: 'Failed', state: 'error', retryable: true },
        ],
      },
    })
    expect(view.findAll('li').map((row) => row.text())).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Attached'),
        expect.stringContaining('Saving'),
        expect.stringContaining('Failed'),
      ])
    )
    expect(view.text()).toContain('Source unavailable')
    await view.get('[aria-label="Retry Failed"]').trigger('click')
    expect(view.emitted('retry')).toEqual([['c']])
  })
})
describe('SheetHeaderActions', () => {
  it('adds no second shell title; executes a contextual action', async () => {
    const view = mount(SheetHeaderActions, {
      props: {
        context: { id: 'attach', label: 'Attach', icon: 'plus' },
        actions: [{ id: 'refresh', label: 'Refresh', icon: 'refresh-cw' }],
      },
    })
    expect(view.find('h1,h2,h3').exists()).toBe(false)
    await view.get('[aria-label="Attach"]').trigger('click')
    expect(view.emitted('action')).toEqual([['attach']])
    expect(view.get('[aria-label="More actions"]').attributes('aria-haspopup')).toBe('menu')
  })
})
describe('Quote', () => {
  it('expands in place and distinguishes an unresolved source from empty text', async () => {
    const view = mount(Quote, {
      props: {
        text: 'A long selectable passage. '.repeat(30),
        source: 'sample.md',
        unresolved: true,
      },
    })
    expect(view.text()).toContain('Source unavailable')
    expect(view.find('.collapse-icon').exists()).toBe(true)
    await view.get('[aria-label="Expand quote"]').trigger('click')
    expect(view.get('blockquote').classes()).not.toContain('abele-quote__text_preview')
    expect(view.get('[aria-label="Collapse quote"]').attributes('aria-expanded')).toBe('true')
    expect(mount(Quote, { props: { text: '' } }).text()).toContain('No quoted text')
  })
})
describe('SwatchPicker', () => {
  it('keeps controlled selection, names every radio and supports arrow-key choices', async () => {
    const view = mount(SwatchPicker, {
      props: {
        modelValue: 'yellow',
        label: 'Annotation colour',
        colors: ['yellow', 'green'],
        underline: true,
      },
    })
    const radios = view.findAll('[role="radio"]')
    expect(radios.map((r) => r.attributes('aria-label'))).toEqual(['Yellow', 'Green'])
    expect(radios[0].attributes('aria-checked')).toBe('true')
    await radios[0].trigger('keydown', { key: 'ArrowRight' })
    const picker = view
    expect(picker.emitted('update:modelValue')).toEqual([['green']])
    expect(radios[0].attributes('aria-checked')).toBe('true')
    await picker.setProps({ disabled: true })
    await radios[1].trigger('click')
    expect(picker.emitted('update:modelValue')).toHaveLength(1)
    expect(view.find('[role="checkbox"]').exists()).toBe(true)
  })
})
describe('Card attachment previews', () => {
  it('does not also open a card when its shared path detail is expanded', async () => {
    const view = mount(Card, {
      props: { title: 'sample.md', path: 'Work/sample.md', clickable: true },
    })
    await view.get('summary').trigger('click')
    expect(view.emitted('click')).toBeUndefined()
  })
  it('does not crop information out of a thumbnail by default', () => {
    const view = mount(Card, {
      props: { title: 'Diagram choice', thumbnail: 'https://example.invalid/sample.png' },
    })
    expect(view.getComponent(Image).props('fit')).toBe('contain')
  })
})
describe('Image thumbnail', () => {
  it('retains an honest loading slot while the source is still resolving', () => {
    const view = mount(Image, { props: { src: '', variant: 'thumbnail', pending: true } })
    expect(view.text()).toContain('Loading image')
    expect(view.find('img').exists()).toBe(false)
    expect(view.attributes('aria-busy')).toBe('true')
  })
  it('holds loading space, handles failure after resolution and recovers on source change', async () => {
    const view = mount(Image, {
      props: {
        src: 'https://example.invalid/sample.png',
        alt: 'Sample diagram',
        variant: 'thumbnail',
        preview: true,
      },
    })
    expect(view.attributes('aria-busy')).toBe('true')
    await view.get('img').trigger('error')
    expect(view.text()).toContain('Image unavailable')
    expect(view.text()).toContain('Sample diagram')
    expect(view.get('button').attributes('disabled')).toBeDefined()
    await view.setProps({ src: 'https://example.invalid/other.png' })
    await view.get('img').trigger('load')
    expect(view.attributes('aria-busy')).toBe('false')
    await view.get('button').trigger('click')
    expect(view.emitted('click')).toHaveLength(1)
  })
})
describe('EmptyState variants', () => {
  it.each([
    ['empty', 'No items yet'],
    ['no-matches', 'No matches'],
    ['loading', 'Loading'],
    ['error', 'Could not load items'],
  ] as const)('announces %s honestly', (variant, text) => {
    const view = mount(EmptyState, { props: { variant }, slots: { action: 'Retry' } })
    expect(view.text()).toContain(text)
    expect(view.text()).toContain('Retry')
    expect(view.attributes('role')).toBe(variant === 'error' ? 'alert' : 'status')
  })
})
describe('ListSectionHeader counts', () => {
  it('shows an explicit zero when folding is disabled', () => {
    const fold = { enabled: false, collapsed: ref(false), toggle: () => {} }
    const view = mount(ListSectionHeader, { props: { text: 'Notes', count: 0, fold } })
    expect(view.text()).toContain('0')
  })
  it('shows loading and filtered counts without caller layout classes', () => {
    const view = mount(ListSectionHeader, {
      props: { text: 'Notes', count: 2, total: 10, loading: true },
    })
    expect(view.text()).toContain('Loading')
    expect(view.text()).toContain('2 of 10')
    expect(view.find('.abele-list-section-header').exists()).toBe(true)
  })
})
