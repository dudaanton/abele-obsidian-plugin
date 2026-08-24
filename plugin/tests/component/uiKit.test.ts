/**
 * The shared vocabulary, from `docs/Design.md`.
 *
 * These are the pieces every screen is built from, so a regression here is a regression
 * everywhere. What is asserted is the contract a screen relies on — what reaches the DOM,
 * what is emitted — never how it looks; happy-dom computes no layout.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Tabs from '@/components/obsidian/Tabs.vue'
import Badge from '@/components/obsidian/Badge.vue'
import Card from '@/components/obsidian/Card.vue'
import CardGrid from '@/components/obsidian/CardGrid.vue'
import Section from '@/components/obsidian/Section.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import Input from '@/components/obsidian/Input.vue'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
]

describe('Tabs', () => {
  it('renders every tab and marks the current one', () => {
    const view = mount(Tabs, { props: { tabs: TABS, modelValue: 'agents' } })

    const rendered = view.findAll('.abele-tabs__tab')
    expect(rendered.map((t) => t.text())).toEqual(['General', 'Agents'])
    expect(rendered[1].classes()).toContain('abele-tabs__tab_active')
    expect(rendered[1].attributes('aria-selected')).toBe('true')
  })

  it('reports the tab a person picked', async () => {
    const view = mount(Tabs, { props: { tabs: TABS, modelValue: 'general' } })

    await view.findAll('.abele-tabs__tab')[1].trigger('click')

    expect(view.emitted('update:modelValue')).toEqual([['agents']])
  })

  it('is reachable from the keyboard', async () => {
    const view = mount(Tabs, { props: { tabs: TABS, modelValue: 'general' } })

    await view.findAll('.abele-tabs__tab')[1].trigger('keydown.enter')

    expect(view.emitted('update:modelValue')).toEqual([['agents']])
  })

  it('is not built from button elements', () => {
    // Obsidian's `button:not(.clickable-icon)` outranks any single class of ours, so a tab
    // built from a button would render as a default grey button whatever we style it.
    const view = mount(Tabs, { props: { tabs: TABS, modelValue: 'general' } })

    expect(view.findAll('button')).toHaveLength(0)
  })

  it('descends into a section rather than sitting side by side when vertical', () => {
    const view = mount(Tabs, { props: { tabs: TABS, modelValue: '', vertical: true } })

    expect(view.classes()).toContain('abele-tabs_vertical')
    expect(view.findAll('.abele-tabs__chevron')).toHaveLength(2)
  })

  it('carries no chevrons when it is a horizontal strip', () => {
    const view = mount(Tabs, { props: { tabs: TABS, modelValue: 'general' } })

    expect(view.findAll('.abele-tabs__chevron')).toHaveLength(0)
  })

  it('separates a nested strip from a screen navigation', () => {
    const primary = mount(Tabs, { props: { tabs: TABS, modelValue: 'general' } })
    const secondary = mount(Tabs, {
      props: { tabs: TABS, modelValue: 'general', level: 'secondary' as const },
    })

    expect(primary.classes()).toContain('abele-tabs_primary')
    expect(secondary.classes()).toContain('abele-tabs_secondary')
  })
})

describe('Badge', () => {
  it('shows its word', () => {
    expect(mount(Badge, { props: { text: 'default' } }).text()).toBe('default')
  })

  it('can stand out', () => {
    const view = mount(Badge, { props: { text: 'default', accent: true } })

    expect(view.classes()).toContain('abele-badge_accent')
  })
})

describe('Card', () => {
  const props = {
    title: 'Researcher',
    subtitle: 'qwen3.5:27b',
    description: 'Reads the vault and answers questions.',
    meta: ['1 prompt', 'no scope'],
  }

  it('shows what the item is', () => {
    const view = mount(Card, { props })

    expect(view.find('.abele-card__name').text()).toBe('Researcher')
    expect(view.find('.abele-card__subtitle').text()).toBe('qwen3.5:27b')
    expect(view.find('.abele-card__description').text()).toContain('Reads the vault')
    expect(view.find('.abele-card__meta').text()).toContain('1 prompt')
  })

  it('leaves out what it was not given', () => {
    const view = mount(Card, { props: { title: 'Bare' } })

    expect(view.find('.abele-card__subtitle').exists()).toBe(false)
    expect(view.find('.abele-card__description').exists()).toBe(false)
    expect(view.find('.abele-card__meta').exists()).toBe(false)
  })

  it('opens only when it is meant to be opened', async () => {
    const inert = mount(Card, { props })
    await inert.trigger('click')
    expect(inert.emitted('click')).toBeUndefined()

    const live = mount(Card, { props: { ...props, clickable: true } })
    await live.trigger('click')
    expect(live.emitted('click')).toEqual([[]])
  })

  it('does not open when an action inside it is pressed', async () => {
    // The delete icon sits inside the card that opens the editor; pressing it must not do both.
    const view = mount(Card, {
      props: { ...props, clickable: true },
      slots: { actions: '<span class="act">x</span>' },
    })

    await view.find('.act').trigger('click')

    expect(view.emitted('click')).toBeUndefined()
  })
})

describe('CardGrid', () => {
  it('gives cards carrying a description a wider column', () => {
    expect(mount(CardGrid).classes()).not.toContain('abele-card-grid_wide')
    expect(mount(CardGrid, { props: { wide: true } }).classes()).toContain('abele-card-grid_wide')
  })
})

describe('Section', () => {
  it('heads a group of settings and explains it', () => {
    const view = mount(Section, {
      props: { title: 'Providers', desc: 'Where models come from.' },
      slots: { default: '<div class="row" />' },
    })

    expect(view.find('h3').text()).toBe('Providers')
    expect(view.find('.abele-section__desc').text()).toBe('Where models come from.')
    expect(view.find('.row').exists()).toBe(true)
  })

  it('omits the explanation when there is none', () => {
    const view = mount(Section, { props: { title: 'Providers' } })

    expect(view.find('.abele-section__desc').exists()).toBe(false)
  })
})

describe('EmptyState', () => {
  it('says what is missing', () => {
    expect(mount(EmptyState, { props: { text: 'No agents yet.' } }).text()).toBe('No agents yet.')
  })

  it('yields to richer content when a screen provides it', () => {
    const view = mount(EmptyState, {
      props: { text: 'No agents yet.' },
      slots: { default: '<span>Skills are notes with <code>type</code>.</span>' },
    })

    expect(view.find('code').exists()).toBe(true)
    expect(view.text()).not.toContain('No agents yet.')
  })
})

describe('Modal', () => {
  it('widens only when asked', () => {
    const plain = mount(ObsidianModal)
    const wide = mount(ObsidianModal, { props: { size: 'wide' as const } })

    const classOf = (v: ReturnType<typeof mount>) =>
      (v.vm as unknown as { modal: { modalEl: HTMLElement } }).modal.modalEl.className

    expect(classOf(plain)).not.toContain('abele-modal_wide')
    expect(classOf(wide)).toContain('abele-modal_wide')
  })
})

describe('Input', () => {
  it('carries its own class, so its width rules actually apply', () => {
    // The class used to sit on a wrapper this component never rendered, which left every
    // field at its intrinsic width and pushed narrow panes sideways.
    const view = mount(Input, { props: { modelValue: 'x' } })

    expect(view.classes()).toContain('abele-obsidian-input')
  })

  it('marks a multi-line field so it can be given room', () => {
    const view = mount(Input, { props: { modelValue: 'x', asTextArea: true } })

    expect(view.element.tagName).toBe('TEXTAREA')
    expect(view.classes()).toContain('abele-obsidian-input_multiline')
  })
})
