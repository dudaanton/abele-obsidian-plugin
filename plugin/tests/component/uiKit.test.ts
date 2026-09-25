/**
 * The shared vocabulary, from `docs/Design.md`.
 *
 * These are the pieces every screen is built from, so a regression here is a regression
 * everywhere. What is asserted is the contract a screen relies on — what reaches the DOM,
 * what is emitted — never how it looks; happy-dom computes no layout.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
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
import Table from '@/components/obsidian/Table.vue'
import Image from '@/components/obsidian/Image.vue'
import TreeItem from '@/components/obsidian/TreeItem.vue'
import Slider from '@/components/obsidian/Slider.vue'
import Avatar from '@/components/obsidian/Avatar.vue'
import Breadcrumbs from '@/components/obsidian/Breadcrumbs.vue'
import { useVault } from '../helpers/testEnv'

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

  it('takes a theme colour by name', () => {
    const view = mount(Badge, { props: { text: 'work', color: 'red' as const } })

    expect(view.classes()).toContain('abele-badge_color-red')
  })

  it('stays the default muted badge when grey', () => {
    const view = mount(Badge, { props: { text: 'work', color: 'grey' as const } })

    expect(view.classes().some((c) => c.startsWith('abele-badge_color-'))).toBe(false)
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

  it('takes a subtitle with something richer than text in it', () => {
    const view = mount(Card, {
      props: { title: 'Fix' },
      slots: { subtitle: () => h('b', 'someone') },
    })
    expect(view.find('.abele-card__subtitle b').text()).toBe('someone')
    expect(
      mount(Card, { props: { title: 'Fix' } })
        .find('.abele-card__subtitle')
        .exists()
    ).toBe(false)
  })

  it('puts an icon before its title when given one, and none otherwise', () => {
    const withIcon = mount(Card, { props: { ...props, icon: 'bot' } })
    expect(withIcon.find('.abele-card__title .abele-card__icon').exists()).toBe(true)

    expect(mount(Card, { props }).find('.abele-card__icon').exists()).toBe(false)
  })

  it('makes its title a link when given an address, and plain text otherwise', () => {
    const linked = mount(Card, { props: { ...props, href: 'https://example.com/a' } })
    const a = linked.find('a.abele-card__name')
    expect(a.attributes('href')).toBe('https://example.com/a')
    expect(a.classes()).toContain('external-link')
    expect(a.text()).toBe('Researcher')

    expect(mount(Card, { props }).find('a').exists()).toBe(false)
  })

  it('never links its title to anything but a web address', () => {
    for (const href of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
    ]) {
      const card = mount(Card, { props: { ...props, href } })
      expect(card.find('a').exists()).toBe(false)
      expect(card.find('.abele-card__name').text()).toBe('Researcher')
    }
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

  it('does not open when a button among its children is pressed, by mouse or by Enter', async () => {
    // A feed card opens the note; the Open, Later and Hide buttons under its text are the
    // script's own. One press, one thing.
    const view = mount(Card, {
      props: { ...props, clickable: true },
      slots: { default: '<p class="prose">text</p><button class="inner">Later</button>' },
    })

    await view.find('.inner').trigger('click')
    await view.find('.inner').trigger('keydown.enter')
    expect(view.emitted('click')).toBeUndefined()

    await view.find('.prose').trigger('click')
    expect(view.emitted('click')).toEqual([[]])
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

describe('TreeItem', () => {
  it("draws a row in Obsidian's own tree classes: glyph, name, flair, the active mark", () => {
    const view = mount(TreeItem, {
      props: { text: 'app.ts', icon: 'file', flair: '3 KB', active: true, path: 'src/app.ts' },
    })
    const self = view.find('.tree-item-self')
    expect(self.classes()).toEqual(expect.arrayContaining(['is-clickable', 'is-active']))
    expect(self.attributes('data-path')).toBe('src/app.ts')
    expect(view.find('.abele-tree-item__glyph').attributes('data-icon')).toBe('file')
    expect(view.find('.tree-item-flair').text()).toBe('3 KB')
    // A file folds nothing: no arrow.
    expect(view.find('.collapse-icon').exists()).toBe(false)
  })

  it('folds its children away and says so', async () => {
    const view = mount(TreeItem, {
      props: { text: 'src', collapsible: true, collapsed: true },
      slots: { default: '<div class="child">app.ts</div>' },
    })
    expect(view.find('.collapse-icon').classes()).toContain('is-collapsed')
    expect(view.find('.tree-item-self').attributes('aria-expanded')).toBe('false')
    expect(view.find('.child').exists()).toBe(false)

    await view.setProps({ collapsed: false })
    expect(view.find('.tree-item-children .child').exists()).toBe(true)
    expect(view.find('.tree-item-self').attributes('aria-expanded')).toBe('true')
  })

  it('carries actions at the end of the row', () => {
    const view = mount(TreeItem, {
      props: { text: 'src' },
      slots: { actions: '<span class="act">open</span>' },
    })
    expect(view.find('.tree-item-flair-outer .abele-tree-item__actions .act').exists()).toBe(true)
  })

  it('is clicked by a click or by Enter, with the modifier keys held', async () => {
    const view = mount(TreeItem, { props: { text: 'app.ts' } })
    await view.find('.tree-item-self').trigger('click')
    await view.find('.tree-item-self').trigger('keydown', { key: 'Enter', metaKey: true })
    const events = view.emitted('click')!.map(([e]) => (e as MouseEvent).metaKey)
    expect(events).toEqual([false, true])
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
   * A full dialog is for something that wants all the room there is, a diagram opened full
   * screen. It is still Obsidian's big dialog underneath, so on a phone it is their sheet, and
   * on a desktop it stops at the size Obsidian lets any dialog be.
   */
  it('marks a full dialog as one, on top of Obsidian big dialog', () => {
    const full = mount(ObsidianModal, { props: { size: 'full' as const } })

    expect(classOf(full)).toContain('abele-modal_full')
    expect(classOf(full)).toContain('mod-lg')
    expect(classOf(full)).not.toContain('abele-modal_tall')
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

  it('an icon can take a theme colour by name', () => {
    const view = mount(Icon, { props: { icon: 'chevron-up', color: 'red' as const } })

    expect(view.classes()).toContain('abele-obsidian-icon_color-red')
  })

  it('a toggle says whether it is on, and a plain icon says nothing of the kind', async () => {
    const view = mount(Icon, {
      props: { icon: 'case-sensitive', tooltip: 'Match case', active: false },
    })
    expect(view.attributes('aria-pressed')).toBe('false')
    expect(view.classes()).not.toContain('abele-obsidian-icon_active')

    await view.setProps({ active: true })
    expect(view.attributes('aria-pressed')).toBe('true')
    expect(view.classes()).toContain('abele-obsidian-icon_active')

    expect(mount(Icon, { props: { icon: 'bot' } }).attributes('aria-pressed')).toBeUndefined()
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

  it('hides what is typed into a passphrase, and asks nothing to remember it', () => {
    const hidden = mount(Input, { props: { modelValue: 'x', password: true } })
    expect(hidden.attributes('type')).toBe('password')
    expect(hidden.attributes('autocomplete')).toBe('off')

    const plain = mount(Input, { props: { modelValue: 'x' } })
    expect(plain.attributes('type')).toBe('text')
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

describe('Table', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'size', label: 'Size' },
  ]
  const rows = [
    { name: 'a', size: 1 },
    { name: 'b', size: 2 },
  ]

  it('renders a header from the columns and a cell per column per row', () => {
    const view = mount(Table, { props: { columns, rows } })

    expect(view.findAll('.abele-table__head').map((h) => h.text())).toEqual(['Name', 'Size'])
    expect(view.findAll('.abele-table__cell').map((c) => c.text())).toEqual(['a', '1', 'b', '2'])
  })

  it('lets a cell be rendered by the caller', () => {
    const view = mount(Table, {
      props: { columns, rows },
      slots: {
        cell: ({ value, column }: { value: unknown; column: { key: string } }) =>
          column.key === 'size' ? `${value} KB` : String(value),
      },
    })

    expect(view.findAll('.abele-table__cell').map((c) => c.text())).toEqual([
      'a',
      '1 KB',
      'b',
      '2 KB',
    ])
  })

  it('reports the row a person clicked when it is clickable', async () => {
    const view = mount(Table, { props: { columns, rows, clickable: true } })

    await view.findAll('.abele-table__row')[1].trigger('click')

    expect(view.emitted('rowClick')?.[0]).toEqual([rows[1], 1])

    const still = mount(Table, { props: { columns, rows } })

    await still.findAll('.abele-table__row')[0].trigger('click')

    expect(still.emitted('rowClick')).toBeUndefined()
  })

  it('is reachable from the keyboard with either key that presses a thing', async () => {
    const view = mount(Table, { props: { columns, rows, clickable: true } })

    await view.findAll('.abele-table__row')[1].trigger('keydown.space')

    expect(view.emitted('rowClick')?.[0]).toEqual([rows[1], 1])

    await view.findAll('.abele-table__row')[0].trigger('keydown.enter')

    expect(view.emitted('rowClick')?.[1]).toEqual([rows[0], 0])
  })

  /**
   * A row is a row, not a button: `role="button"` would take it out of the table for anyone
   * reading the table with a screen reader, which is the one thing a table is for.
   */
  it('stays a row even when it is a target', () => {
    const view = mount(Table, { props: { columns, rows, clickable: true } })

    const row = view.findAll('.abele-table__row')[0]
    expect(row.attributes('role')).toBeUndefined()
    expect(row.attributes('tabindex')).toBe('0')
    expect(view.findAll('.abele-table__row')[0].element.tagName).toBe('TR')
  })

  it('leaves a row that is not a target out of the tab order', () => {
    const view = mount(Table, { props: { columns, rows } })

    expect(view.findAll('.abele-table__row')[0].attributes('tabindex')).toBeUndefined()
  })

  /**
   * A control inside a clickable row keeps its keys and its clicks: Space in a field is a
   * space, a press on a button is that button's, and neither is also the row being chosen.
   */
  describe('with a control in a cell', () => {
    const withInput = () =>
      mount(Table, {
        props: { columns, rows, clickable: true },
        slots: {
          cell: ({ value, column }: { value: unknown; column: { key: string } }) =>
            column.key === 'name' ? h('input', { class: 'field', value }) : String(value),
        },
      })

    it('lets Space through to a field without choosing the row', () => {
      const view = withInput()
      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })

      view.find('input.field').element.dispatchEvent(event)

      expect(view.emitted('rowClick')).toBeUndefined()
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not take a click on the field as a click on the row', async () => {
      const view = withInput()

      await view.find('input.field').trigger('click')

      expect(view.emitted('rowClick')).toBeUndefined()
    })

    it('still reports a click on a plain cell of the same row', async () => {
      const view = withInput()

      await view.findAll('.abele-table__cell')[1].trigger('click')

      expect(view.emitted('rowClick')?.[0]).toEqual([rows[0], 0])
    })
  })
})

/**
 * The default cell, which is pointed at data whose shape nobody has checked. Every case here
 * is something a script has actually handed a table — a vault file among them, which knows
 * its folder and is known back by it.
 */
describe('a table cell nobody wrote a slot for', () => {
  const one = (value: unknown) =>
    mount(Table, {
      props: { columns: [{ key: 'v', label: 'V' }], rows: [{ v: value }] },
    }).find('.abele-table__cell')

  it('writes a date as a date, not as a quoted ISO string', () => {
    const date = new Date('2026-09-04T10:00:00Z')

    const cell = one(date).text()

    expect(cell).toBe(date.toLocaleString())
    expect(cell).not.toContain('"')
  })

  it('writes a list as its items', () => {
    expect(one(['a', 'b']).text()).toBe('a, b')
  })

  it('writes a map as JSON rather than as the default stringification', () => {
    expect(one({ a: 1 }).text()).toBe('{"a":1}')
  })

  it('survives a value that refers back to itself', () => {
    const folder: Record<string, unknown> = { name: 'Media' }
    folder.children = [{ path: 'Media/a.png', parent: folder }]

    expect(one(folder).text()).toBe('[object]')
  })

  it('leaves a cell empty when the row has nothing under that column', () => {
    const view = mount(Table, {
      props: { columns: [{ key: 'missing', label: 'M' }], rows: [{ other: 1 }] },
    })

    expect(view.find('.abele-table__cell').text()).toBe('')
  })
})

describe('Image', () => {
  it('passes a URL through and resolves a vault path', () => {
    const app = useVault([{ path: 'Media/a.png', content: '' }])
    ;(
      app.vault as unknown as { getResourcePath: (f: { path: string }) => string }
    ).getResourcePath = (f) => `app://vault/${f.path}`

    const url = mount(Image, { props: { src: 'https://x/y.png', alt: 'y' } })
    expect(url.find('img').attributes('src')).toBe('https://x/y.png')

    const local = mount(Image, { props: { src: 'Media/a.png' } })
    expect(local.find('img').attributes('src')).toBe('app://vault/Media/a.png')

    const missing = mount(Image, { props: { src: 'Media/none.png', alt: 'gone' } })
    expect(missing.classes()).toContain('abele-image_missing')
    expect(missing.attributes('alt')).toBe('gone')
    // Not an empty `src`: that is a request for the page itself, which the browser answers by
    // drawing the broken-image glyph instead of the alt text.
    expect(missing.attributes('src')).toBeUndefined()
  })

  it('leaves a picture that carries its own bytes alone', () => {
    useVault([])

    const inline = mount(Image, {
      props: { src: 'data:image/png;base64,iVBORw0KGgo=' },
    })

    expect(inline.attributes('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(inline.classes()).not.toContain('abele-image_missing')
  })

  it('says a picture is decoration when it was given no words', () => {
    useVault([])

    const view = mount(Image, { props: { src: 'https://x/y.png' } })

    expect(view.attributes('alt')).toBe('')
  })

  it('carries its fit as a modifier and emits click', async () => {
    const view = mount(Image, { props: { src: 'https://x/y.png', fit: 'cover' } })

    expect(view.classes()).toContain('abele-image_fit-cover')

    await view.trigger('click')

    expect(view.emitted('click')).toHaveLength(1)
  })
})

describe('Image given the name a note links a picture by', () => {
  it('finds the file the way a link does when no file sits at the path as written', () => {
    const app = useVault([{ path: 'Attachments/poster.jpg', content: '' }])
    ;(
      app.vault as unknown as { getResourcePath: (f: { path: string }) => string }
    ).getResourcePath = (f) => `app://vault/${f.path}`

    const byName = mount(Image, { props: { src: 'poster.jpg' } })

    expect(byName.attributes('src')).toBe('app://vault/Attachments/poster.jpg')
    expect(byName.classes()).not.toContain('abele-image_missing')
  })
})

describe('Card as a post', () => {
  it('puts the cover across the top and the title as a heading', () => {
    const app = useVault([{ path: 'Attachments/poster.jpg', content: '' }])
    ;(
      app.vault as unknown as { getResourcePath: (f: { path: string }) => string }
    ).getResourcePath = (f) => `app://vault/${f.path}`

    const post = mount(Card, {
      props: { title: 'Aftersun', cover: 'poster.jpg', large: true, description: 'A film.' },
    })

    expect(post.classes()).toContain('abele-card_large')
    const cover = post.find('.abele-card__cover img')
    expect(cover.attributes('src')).toBe('app://vault/Attachments/poster.jpg')
    expect(cover.attributes('alt')).toBe('Aftersun')
    // The picture comes before the words, the way a post reads.
    expect(post.element.firstElementChild?.classList.contains('abele-card__cover')).toBe(true)
  })

  it('is the tile it always was without them', () => {
    useVault([])
    const tile = mount(Card, { props: { title: 'Bare' } })

    expect(tile.find('.abele-card__cover').exists()).toBe(false)
    expect(tile.classes()).not.toContain('abele-card_large')
  })
})

describe('Avatar', () => {
  it('draws the picture as decoration, the name beside it saying who it is', () => {
    const view = mount(Avatar, { props: { src: 'https://example.com/a.png', name: 'octocat' } })
    expect(view.find('img').attributes('src')).toBe('https://example.com/a.png')
    expect(view.find('img').attributes('alt')).toBe('')
    expect(view.attributes('aria-hidden')).toBe('true')
  })

  it('shows the first letter when there is no picture, or it would not load', async () => {
    const none = mount(Avatar, { props: { src: null, name: 'octocat' } })
    expect(none.find('img').exists()).toBe(false)
    expect(none.attributes('data-initial')).toBe('O')
    // Drawn by CSS: the letter is not part of the text around it.
    expect(none.text()).toBe('')

    const broken = mount(Avatar, { props: { src: 'https://example.com/x.png', name: 'hubot' } })
    await broken.find('img').trigger('error')
    expect(broken.find('img').exists()).toBe(false)
    await broken.setProps({ src: 'https://example.com/y.png' })
    expect(broken.find('img').exists()).toBe(true)
  })
})

describe('Slider', () => {
  it("is Obsidian's own slider, following the thumb while dragged and settling when let go", async () => {
    const slider = mount(Slider, {
      props: { modelValue: 20, min: 0, max: 1000, step: 1, label: 'Go to a place in the book' },
    })
    const input = slider.find('input')
    expect(input.classes()).toContain('slider')
    expect(input.attributes('type')).toBe('range')
    expect(input.attributes('aria-label')).toBe('Go to a place in the book')
    ;(input.element as HTMLInputElement).value = '500'
    await input.trigger('input')
    expect(slider.emitted('input')).toEqual([[500]])
    expect(slider.emitted('update:model-value')).toBeUndefined()

    expect((input.element as HTMLInputElement).style.getPropertyValue('--slider-fill-ratio')).toBe(
      '0.5'
    )

    await input.trigger('change')
    expect(slider.emitted('update:model-value')).toEqual([[500]])

    await slider.setProps({ modelValue: 250 })
    expect((input.element as HTMLInputElement).style.getPropertyValue('--slider-fill-ratio')).toBe(
      '0.25'
    )
  })
})

describe('Breadcrumbs', () => {
  const ITEMS = [
    { label: 'Riga trip', tooltip: 'Back to the chat' },
    { label: 'Which train?', tooltip: 'Back to this comment' },
    { label: 'Sleeping cars?' },
  ]

  it('draws every level in order, separated, the last one as where you are', () => {
    const view = mount(Breadcrumbs, { props: { items: ITEMS } })

    const items = view.findAll('.abele-breadcrumbs__item')
    expect(items.map((i) => i.text())).toEqual(['Riga trip', 'Which train?', 'Sleeping cars?'])
    expect(view.findAll('.abele-breadcrumbs__separator')).toHaveLength(2)
    expect(items[2].classes()).toContain('abele-breadcrumbs__item_current')
    expect(items[2].attributes('aria-current')).toBe('page')
    expect(items[2].attributes('role')).toBeUndefined()
  })

  it('says which level was pressed, by click and by Enter', async () => {
    const view = mount(Breadcrumbs, { props: { items: ITEMS } })
    const items = view.findAll('.abele-breadcrumbs__item')

    await items[1].trigger('click')
    await items[0].trigger('keydown', { key: 'Enter' })

    expect(view.emitted('select')).toEqual([[1], [0]])
    expect(items[0].attributes('role')).toBe('button')
  })

  it('is not pressed at the level you are on', async () => {
    const view = mount(Breadcrumbs, { props: { items: ITEMS } })

    await view.findAll('.abele-breadcrumbs__item')[2].trigger('click')

    expect(view.emitted('select')).toBeUndefined()
  })
})
