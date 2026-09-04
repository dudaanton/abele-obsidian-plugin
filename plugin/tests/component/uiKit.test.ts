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
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Input from '@/components/obsidian/Input.vue'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
]

/** Two ticks: one for the watcher, one for the `nextTick` inside the reveal. */
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

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

  it('brings the active tab into view when it changes, and once on mount', async () => {
    // On a phone the strip is one row that scrolls sideways; a dialog opened on its last tab
    // would otherwise show the strip scrolled to the first. happy-dom has no scrollIntoView,
    // which is also why the component asks before calling it.
    const seen: string[] = []
    const proto = HTMLElement.prototype as HTMLElement & { scrollIntoView?: unknown }
    const before = proto.scrollIntoView
    proto.scrollIntoView = function (this: HTMLElement) {
      seen.push(this.textContent?.trim() ?? '')
    }
    try {
      const view = mount(Tabs, { props: { tabs: TABS, modelValue: 'agents' } })
      await flush()
      expect(seen).toEqual(['Agents'])

      await view.setProps({ modelValue: 'general' })
      await flush()
      expect(seen).toEqual(['Agents', 'General'])
    } finally {
      proto.scrollIntoView = before
    }
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

  /** A recap sentence in a footer list is a summary; unclamped, one card buries the next. */
  it('cuts the description short only when it is asked to', () => {
    expect(mount(Card, { props }).find('.abele-card__description').classes()).not.toContain(
      'abele-card__description_clamped'
    )
    expect(
      mount(Card, { props: { ...props, clampDescription: true } })
        .find('.abele-card__description')
        .classes()
    ).toContain('abele-card__description_clamped')
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

describe('Card being chosen from', () => {
  it('says so, for anyone not going by colour', () => {
    const wrapper = mount(Card, { props: { title: 'AI general', clickable: true, selected: true } })

    expect(wrapper.find('.abele-card').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.abele-card').classes()).toContain('abele-card_selected')
  })

  it('is plainly not chosen when it is not', () => {
    const wrapper = mount(Card, {
      props: { title: 'AI general', clickable: true, selected: false },
    })

    expect(wrapper.find('.abele-card').attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.abele-card').classes()).not.toContain('abele-card_selected')
  })

  /** A card nobody is choosing between is not "unpressed" — it is not a choice at all. */
  it('claims no pressed state when it is not one of a selection', () => {
    const wrapper = mount(Card, { props: { title: 'AI general', clickable: true } })

    expect(wrapper.find('.abele-card').attributes('aria-pressed')).toBeUndefined()
  })
})

describe('CardGrid', () => {
  it('gives cards carrying a description a wider column', () => {
    expect(mount(CardGrid).classes()).not.toContain('abele-card-grid_wide')
    expect(mount(CardGrid, { props: { wide: true } }).classes()).toContain('abele-card-grid_wide')
  })

  it('puts one card per row when they hold something to type into', () => {
    expect(mount(CardGrid, { props: { stack: true } }).classes()).toContain('abele-card-grid_stack')
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
  const classOf = (v: ReturnType<typeof mount>) =>
    (v.vm as unknown as { modal: { modalEl: HTMLElement } }).modal.modalEl.className

  it('widens only when asked', () => {
    const plain = mount(ObsidianModal)
    const wide = mount(ObsidianModal, { props: { size: 'wide' as const } })

    expect(classOf(plain)).not.toContain('abele-modal_wide')
    expect(classOf(wide)).toContain('abele-modal_wide')
  })

  /**
   * A tall dialog is not a wider one: it is a dialog that fills the height Obsidian allows it
   * and scrolls inside, and on a phone it is the sheet Obsidian draws for its own big dialogs.
   * `mod-lg` is theirs — asking for it is how the geometry stays theirs, which is the whole
   * lesson of the sheet that put its close button under the notch.
   */
  it('marks a tall dialog as one, and asks Obsidian for its own sheet', () => {
    const tall = mount(ObsidianModal, { props: { size: 'tall' as const } })
    const plain = mount(ObsidianModal)

    expect(classOf(tall)).toContain('abele-modal_tall')
    expect(classOf(tall)).toContain('mod-lg')
    expect(classOf(tall)).not.toContain('abele-modal_wide')
    expect(classOf(plain)).not.toContain('abele-modal_tall')
    expect(classOf(plain)).not.toContain('mod-lg')
  })

  /**
   * A rule of ours has to be able to name the element this component appends. Reaching it as
   * `.modal-content > div` would make every such rule depend on the shape of the DOM the kit
   * happens to build.
   */
  it('names the element it mounts into', () => {
    const view = mount(ObsidianModal)
    const modalEl = (view.vm as unknown as { modal: { modalEl: HTMLElement } }).modal.modalEl

    expect(modalEl.querySelector('.abele-modal__body')).not.toBeNull()
  })
})

describe('ConfirmModal', () => {
  const props = { title: 'Delete agent', message: 'Delete Researcher? This cannot be undone.' }

  /** The dialog's content lives in the modal's slot, which a stub must keep. */
  const mountConfirm = () =>
    mount(ConfirmModal, {
      props,
      global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
    })

  it('names what is about to be lost', () => {
    const view = mountConfirm()

    expect(view.find('.abele-confirm__message').text()).toContain('Delete Researcher?')
  })

  it('marks the destructive choice as destructive', () => {
    const view = mountConfirm()

    const confirm = view.findAllComponents(Button)[1]
    expect(confirm.props('warning')).toBe(true)
    expect(confirm.props('text')).toBe('Delete')
  })

  it('destroys nothing when it is dismissed', async () => {
    const view = mountConfirm()

    await view.findAllComponents(Button)[0].vm.$emit('click')

    expect(view.emitted('confirm')).toBeUndefined()
    expect(view.emitted('close')).toBeTruthy()
  })

  it('confirms once, and closes itself afterwards', async () => {
    const view = mountConfirm()

    await view.findAllComponents(Button)[1].vm.$emit('click')

    expect(view.emitted('confirm')).toHaveLength(1)
    expect(view.emitted('close')).toHaveLength(1)
  })
})

describe('tooltips', () => {
  // Obsidian's `setTooltip` shows the text on hover and puts it on `aria-label`, so this is
  // both the tooltip and what a screen reader announces.
  it('a button says what it does', () => {
    const view = mount(Button, { props: { text: 'Save', tooltip: 'Keep these settings' } })

    expect(view.attributes('aria-label')).toBe('Keep these settings')
  })

  it('an icon says what it does', () => {
    const view = mount(Icon, { props: { icon: 'trash', tooltip: 'Delete this agent' } })

    expect(view.attributes('aria-label')).toBe('Delete this agent')
  })

  it('follows the label when it changes with the state', async () => {
    const view = mount(Icon, { props: { icon: 'star', tooltip: 'Make this the default' } })

    await view.setProps({ tooltip: 'Already the default' })

    expect(view.attributes('aria-label')).toBe('Already the default')
  })

  it('a decorative glyph is left unlabelled', () => {
    const view = mount(Icon, { props: { icon: 'bot' } })

    expect(view.attributes('aria-label')).toBeUndefined()
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

describe('Input as a textarea', () => {
  it('stands at the number of rows it is given', () => {
    const view = mount(Input, { props: { asTextArea: true, rows: 2, modelValue: 'a\nb' } })

    const field = view.find('textarea')
    expect(field.attributes('rows')).toBe('2')
    // The six-line floor is for a field nobody sized; a sized one would only be pushed open
    // by it, and a one-line question would arrive looking like a form.
    expect(field.classes()).toContain('abele-obsidian-input_sized')
  })

  it('keeps the six-line floor for a textarea nobody sized', () => {
    const view = mount(Input, { props: { asTextArea: true, modelValue: '' } })

    const field = view.find('textarea')
    expect(field.attributes('rows')).toBeUndefined()
    expect(field.classes()).toContain('abele-obsidian-input_multiline')
    expect(field.classes()).not.toContain('abele-obsidian-input_sized')
  })

  it('does not size a single-line input', () => {
    const view = mount(Input, { props: { rows: 3, modelValue: '' } })

    expect(view.find('input').attributes('rows')).toBeUndefined()
  })
})

/**
 * A strip whose labels are too short to explain themselves — the comment card numbers its
 * tabs "1" and "2" — needs the glyph and the tooltip to say what is being switched between.
 */
describe('Tabs whose labels cannot carry the meaning', () => {
  it('draws a glyph beside a tab that asks for one', () => {
    const view = mount(Tabs, {
      props: { tabs: [{ id: 'a', label: '1', icon: 'message-circle' }], modelValue: 'a' },
    })

    expect(view.findComponent(Icon).props('icon')).toBe('message-circle')
  })

  it('says what a tab is when its label cannot', () => {
    const view = mount(Tabs, {
      props: { tabs: [{ id: 'a', label: '1', tooltip: 'Comment 1 of 2' }], modelValue: 'a' },
    })

    expect(view.find('.abele-tabs__tab').attributes('aria-label')).toBe('Comment 1 of 2')
  })

  it('leaves an ordinary tab bare', () => {
    const view = mount(Tabs, { props: { tabs: [{ id: 'a', label: 'General' }], modelValue: 'a' } })

    expect(view.findComponent(Icon).exists()).toBe(false)
    expect(view.find('.abele-tabs__tab').attributes('aria-label')).toBeUndefined()
  })
})
