/**
 * The quick button on the page, and its settings tab.
 *
 * happy-dom computes no layout, so where the button stands is held in `tests/unit/quickButton.test.ts`
 * and on a phone in `tests/e2e/quickButton.e2e.test.ts`. Here: that it is there only when it
 * should be — switched on, on a phone, nothing being typed, selected or asked in a dialog, no
 * other drawer over the screen, the view not busy — that it tucks itself away while a book is read
 * forward, that a tap opens the menu and a drag moves it and remembers where it was left.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { Menu, Platform } from 'obsidian'
import QuickButton from '@/components/quick/QuickButton.vue'
import FloatingButton from '@/components/obsidian/FloatingButton.vue'
import QuickButtonSettings from '@/components/settings/QuickButtonSettings.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { DEFAULT_QUICK_BUTTON, type QuickButtonSettings as Stored } from '@/quickButton/settings'
import { configureAbele } from '../helpers/testEnv'

vi.mock('@/helpers/suggesters/RunnablePicker', () => ({
  listCommands: () => [{ id: 'daily-notes', name: 'Open today’s daily note', icon: 'calendar' }],
  pickCommand: vi.fn(async () => ({ id: 'daily-notes', name: 'Open today’s daily note' })),
  pickScript: vi.fn(async () => ({ meta: { name: 'Add film' } })),
}))

interface FakeView {
  containerEl: HTMLElement
  fillQuickMenu?: (menu: Menu) => void
  quickButtonBusy?: () => boolean
  quickButtonProgress?: () => number
  quickButtonTucked?: () => boolean
}

let wrapper: VueWrapper | null = null
let config: AbeleConfig
const workspace = {
  leftSplit: { collapsed: true },
  rightSplit: { collapsed: true },
  rootSplit: {},
  leaves: [] as { view: FakeView; getRoot: () => unknown }[],
  getMostRecentLeaf(): { view: FakeView } | null {
    return this.leaves.find((l) => l.getRoot() === this.rootSplit) ?? null
  },
  iterateAllLeaves(cb: (leaf: unknown) => void) {
    this.leaves.forEach(cb)
  },
  on: () => ({}),
  offref: () => {},
  getActiveViewOfType: () => null,
}

function viewIn(root: unknown, extra: Partial<FakeView> = {}) {
  const containerEl = document.body.createDiv({ cls: 'workspace-leaf-content' })
  const view: FakeView = { containerEl, ...extra }
  workspace.leaves.push({ view, getRoot: () => root })
  return view
}

const settle = async () => {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await nextTick()
}

const buttonEl = () => document.querySelector<HTMLElement>('.abele-floating-button')

function setStored(change: Partial<Stored>) {
  config.quickButton = { ...DEFAULT_QUICK_BUTTON, enabled: true, ...change }
  config.version.value++
}

async function mountButton() {
  wrapper = mount(QuickButton, { attachTo: document.body })
  await settle()
}

beforeEach(() => {
  config = configureAbele()
  vi.spyOn(config, 'saveSettings').mockImplementation(async () => {
    config.version.value++
  })
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = {
    workspace,
    commands: { commands: {}, findCommand: () => undefined, executeCommandById: vi.fn() },
  }
  workspace.leaves = []
  workspace.leftSplit.collapsed = true
  workspace.rightSplit.collapsed = true
  Object.assign(Platform, { isMobile: true, isPhone: true, isDesktop: false })
  setStored({})
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  Object.assign(Platform, { isMobile: false, isPhone: false, isDesktop: true })
  document.body.className = ''
  document.body.replaceChildren()
  document.getSelection()?.removeAllRanges()
  document.documentElement.style.removeProperty('--keyboard-height')
  vi.restoreAllMocks()
})

describe('the quick button', () => {
  it('is there on a phone once switched on, and not while off', async () => {
    viewIn(workspace.rootSplit)
    await mountButton()
    expect(buttonEl()).not.toBeNull()
    expect(buttonEl()!.getAttribute('aria-label')).toBe('Open the quick menu')

    setStored({ enabled: false })
    await settle()
    expect(buttonEl()).toBeNull()
  })

  it('is not there on a computer, nor on a tablet unless asked', async () => {
    Object.assign(Platform, { isMobile: false, isPhone: false, isDesktop: true })
    viewIn(workspace.rootSplit)
    await mountButton()
    expect(buttonEl()).toBeNull()
    wrapper!.unmount()

    Object.assign(Platform, { isMobile: true, isPhone: false })
    await mountButton()
    expect(buttonEl()).toBeNull()
    wrapper!.unmount()

    setStored({ tablet: true })
    await mountButton()
    expect(buttonEl()).not.toBeNull()
  })

  it('goes while a field has focus, and comes back when it lets go', async () => {
    const view = viewIn(workspace.rootSplit)
    await mountButton()
    const field = view.containerEl.appendChild(document.createElement('textarea'))
    field.focus()
    await settle()
    expect(buttonEl()).toBeNull()

    field.blur()
    await settle()
    expect(buttonEl()).not.toBeNull()
  })

  it('goes while the keyboard height is written', async () => {
    viewIn(workspace.rootSplit)
    await mountButton()
    document.documentElement.style.setProperty('--keyboard-height', '336px')
    window.dispatchEvent(new Event('keyboardWillShow'))
    await settle()
    expect(buttonEl()).toBeNull()
  })

  it('where the app reports the keyboard, believes it over a field’s focus', async () => {
    const view = viewIn(workspace.rootSplit)
    await mountButton()
    const field = view.containerEl.appendChild(document.createElement('textarea'))
    field.focus()
    document.documentElement.style.setProperty('--keyboard-height', '336px')
    window.dispatchEvent(new Event('keyboardWillShow'))
    await settle()
    expect(buttonEl()).toBeNull()

    // The keyboard put away, the editor keeping its focus: iOS does that.
    document.documentElement.style.removeProperty('--keyboard-height')
    window.dispatchEvent(new Event('keyboardWillHide'))
    await settle()
    expect(document.activeElement).toBe(field)
    expect(buttonEl()).not.toBeNull()
  })

  it('goes while words are selected on the page', async () => {
    const view = viewIn(workspace.rootSplit)
    view.containerEl.appendChild(document.createElement('p')).textContent =
      'Some words to select here.'
    await mountButton()
    const range = document.createRange()
    range.selectNodeContents(view.containerEl.querySelector('p')!)
    document.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await settle()
    expect(buttonEl()).toBeNull()
  })

  it('goes while a dialog is open', async () => {
    viewIn(workspace.rootSplit)
    await mountButton()
    const dialog = document.body.createDiv({ cls: 'modal-container' })
    await settle()
    expect(buttonEl()).toBeNull()
    dialog.remove()
    await settle()
    expect(buttonEl()).not.toBeNull()
  })

  it('stays over the chat’s drawer, and goes over any other', async () => {
    viewIn(workspace.rootSplit)
    const drawer = {}
    ;(workspace.rightSplit as unknown as { collapsed: boolean }).collapsed = false
    const chat = viewIn(drawer, { fillQuickMenu: () => {} })
    ;(workspace as unknown as { rightSplit: unknown }).rightSplit = Object.assign(drawer, {
      collapsed: false,
    })
    chat.containerEl.getBoundingClientRect = () =>
      ({ width: 300, height: 800, top: 0, left: 0, right: 300, bottom: 800 }) as DOMRect
    await mountButton()
    expect(buttonEl()).not.toBeNull()

    delete chat.fillQuickMenu
    document.body.createDiv() // any change on the page makes it look again
    await settle()
    expect(buttonEl()).toBeNull()
    ;(workspace as unknown as { rightSplit: unknown }).rightSplit = { collapsed: true }
  })

  it('goes while a book is busy, and tucks itself away as it is read forward', async () => {
    const model = reactive({ busy: false, fraction: 0.1 })
    viewIn(workspace.rootSplit, {
      quickButtonBusy: () => model.busy,
      quickButtonProgress: () => model.fraction,
    })
    await mountButton()
    expect(buttonEl()!.classList).not.toContain('abele-floating-button_tucked')

    // Opening, the book moves to where it was left: that is not reading forward.
    model.fraction = 0.3
    await settle()
    expect(buttonEl()!.classList).not.toContain('abele-floating-button_tucked')
    model.fraction = 0.1
    await settle()

    const later = Date.now() + 5000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    model.fraction = 0.12
    await settle()
    expect(buttonEl()!.classList).toContain('abele-floating-button_tucked')

    model.fraction = 0.11
    await settle()
    expect(buttonEl()!.classList).not.toContain('abele-floating-button_tucked')

    model.busy = true
    await settle()
    expect(buttonEl()).toBeNull()
  })

  it('rests tucked away over a view read to the edges — a book', async () => {
    viewIn(workspace.rootSplit, { quickButtonTucked: () => true } as Partial<FakeView>)
    await mountButton()
    expect(buttonEl()!.classList).toContain('abele-floating-button_tucked')
  })

  it('tucks itself away while Obsidian has hidden its navigation bar', async () => {
    viewIn(workspace.rootSplit)
    await mountButton()
    document.body.classList.add('is-hidden-nav')
    await settle()
    expect(buttonEl()!.classList).toContain('abele-floating-button_tucked')
  })

  it('opens the menu on a tap, with what the view offers in it', async () => {
    viewIn(workspace.rootSplit, {
      fillQuickMenu: (menu) => menu.addItem((i) => i.setTitle('Search in the book')),
    })
    const shown: Menu[] = []
    vi.spyOn(Menu.prototype, 'showAtPosition').mockImplementation(function (this: Menu) {
      shown.push(this)
      return this
    })
    await mountButton()
    const el = buttonEl()!
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 5, clientY: 5 }))
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 6, clientY: 5 }))
    await settle()
    // Not yet: a touch is followed by mouse events, which would land on the menu's backdrop.
    expect(shown).toHaveLength(0)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(shown).toHaveLength(1)
    expect(shown[0].items.map((i) => i.title)).toContain('Search in the book')
    expect(el.getAttribute('aria-expanded')).toBe('true')
    shown[0].hide()
    await settle()
    expect(el.getAttribute('aria-expanded')).toBe('false')
  })

  it('is moved by a drag, goes to the nearer side and remembers it', async () => {
    viewIn(workspace.rootSplit)
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    await mountButton()
    const el = buttonEl()!
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: 300, clientY: 500 }))
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 100, clientY: 300 }))
    await nextTick()
    expect(el.classList).toContain('abele-floating-button_dragging')
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: 100, clientY: 300 }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    expect(show).not.toHaveBeenCalled()
    expect(config.saveSettings).toHaveBeenCalled()
    expect(config.quickButton.side).toBe('left')
    expect(el.classList).toContain('abele-floating-button_left')
  })
})

describe('the settings tab', () => {
  it('switches the button on and off, and sets its side', async () => {
    setStored({ enabled: false })
    wrapper = mount(QuickButtonSettings, { attachTo: document.body })
    await settle()
    const checkbox = wrapper.find('.checkbox-container')
    await checkbox.trigger('click')
    await settle()
    expect(config.quickButton.enabled).toBe(true)

    await wrapper.find('select').setValue('left')
    await settle()
    expect(config.quickButton.side).toBe('left')
  })

  it('adds a command and a script, orders them and takes one out after asking', async () => {
    wrapper = mount(QuickButtonSettings, { attachTo: document.body })
    await settle()
    expect(wrapper.text()).toContain('Nothing of your own yet.')

    const button = (text: string) => wrapper!.findAll('button').find((b) => b.text() === text)!
    await button('Add a command').trigger('click')
    await settle()
    await button('Add a script').trigger('click')
    await settle()
    expect(config.quickButton.actions.map((a) => a.commandId || a.scriptName)).toEqual([
      'daily-notes',
      'Add film',
    ])
    expect(wrapper.text()).toContain('Open today’s daily note')

    const up = wrapper.findAll('.abele-obsidian-icon').filter((i) => i.html().includes('arrow-up'))
    await up[1].trigger('click')
    await settle()
    expect(config.quickButton.actions[0].scriptName).toBe('Add film')

    const trash = wrapper.findAll('.abele-obsidian-icon').filter((i) => i.html().includes('trash'))
    await trash[0].trigger('click')
    await settle()
    expect(config.quickButton.actions).toHaveLength(2)
    const takeOut = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Take out'
    )!
    takeOut.click()
    await settle()
    expect(config.quickButton.actions.map((a) => a.commandId)).toEqual(['daily-notes'])
  })
})

describe('the kit’s floating button', () => {
  it('is a labelled button in Obsidian’s raised surface, at the side and tucked as told', async () => {
    wrapper = mount(FloatingButton, {
      props: { icon: 'zap', label: 'Open the quick menu', side: 'left', tucked: true },
      attachTo: document.body,
    })
    const el = wrapper.find('.abele-floating-button')
    expect(el.attributes('role')).toBe('button')
    expect(el.attributes('aria-label')).toBe('Open the quick menu')
    expect(el.classes()).toEqual(
      expect.arrayContaining([
        'mod-raised',
        'abele-floating-button_left',
        'abele-floating-button_tucked',
      ])
    )
    expect(wrapper.find('.abele-floating-button__icon').attributes('data-icon')).toBe('zap')
  })
})
