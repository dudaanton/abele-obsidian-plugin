/**
 * The second host for a comment card: a dialog, for a pane with no margin and for a phone.
 *
 * happy-dom computes no layout, so nothing here can prove the input stays above the keyboard —
 * that is the screenshot pass. What it can prove is the wiring that decides it: the kit is
 * asked for a sheet rather than a dialog, the card is handed the same entry the marker knows,
 * the one value that says a card is expanded is set while the sheet lives and put back when it
 * goes, and the dialog is told how much viewport there actually is.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, toRaw } from 'vue'
import CommentSheet from '@/components/CommentSheet.vue'
import { CommentEntry } from '@/entities/Comment'
import { CommentService } from '@/ai/CommentService'
import type { ChatSession } from '@/ai/ChatSession'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

/** The kit modal teleports into a real Obsidian dialog; the slot is all this tier needs. */
const ModalStub = {
  name: 'ObsidianModal',
  props: ['title', 'size'],
  emits: ['close'],
  template: '<div class="modal-stub"><slot /></div>',
}

/** The card has a test of its own; here it stands for "whatever was handed the entry". */
const CardStub = {
  name: 'CommentCard',
  props: ['entry', 'host'],
  emits: ['promoted'],
  template: '<div class="card-stub" />',
}

/**
 * A stand-in for a comment read from its file. `anchor` is a ref the service's own watcher
 * dereferences whenever the open card changes, and it is empty here because a note would send
 * that watcher into the editor, which this tier has none of.
 */
const loadedComment = () =>
  ({
    id: 'session-1',
    anchor: { value: null },
    flush: async () => {},
    destroy: () => {},
  }) as unknown as ChatSession

const entry = () =>
  new CommentEntry({
    id: 'vue-1',
    ids: ['k7d2ph'],
    notePath: 'Notes/Anchor.md',
    markerFrom: 20,
  })

const mountSheet = (subject = entry()) =>
  mount(CommentSheet, {
    props: { entry: subject },
    global: { stubs: { ObsidianModal: ModalStub, CommentCard: CardStub } },
  })

beforeEach(() => {
  // The service watches its own `open` and asks each session where its note is, which goes
  // through the comment folder: without a vault and a configuration behind it, expanding a
  // card throws before the sheet is ever asked anything.
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  CommentService.getInstance().destroy()
})

afterEach(() => {
  CommentService.getInstance().destroy()
})

describe('the comment sheet', () => {
  it('titles itself with the note the comment is anchored in', () => {
    const view = mountSheet()

    expect(view.findComponent(ModalStub).props('title')).toBe('Anchor')
  })

  it('asks the kit for a sheet, not for a dialog', () => {
    const view = mountSheet()

    expect(view.findComponent(ModalStub).props('size')).toBe('sheet')
  })

  it('hands the card the entry the marker was pressed on', () => {
    const subject = entry()
    const view = mountSheet(subject)

    // `toRaw`, because a mounted component's props are reactive: the card is handed a proxy
    // of the entry the test made, and identity is the assertion that matters.
    expect(toRaw(view.findComponent(CardStub).props('entry'))).toBe(subject)
  })

  it('tells the card it is hosted here, so it offers no second way to close', () => {
    const view = mountSheet()

    // The dialog already has an ×; a fold chevron beside it is two controls for one act.
    expect(view.findComponent(CardStub).props('host')).toBe('sheet')
  })

  it('expands the card it is showing, everywhere', () => {
    mountSheet()

    // The marker in the text reads the same value, so the icon and the sheet agree.
    expect(CommentService.getInstance().open.value).toBe('k7d2ph')
  })

  it('folds the card again when it closes, and keeps the session', () => {
    const service = CommentService.getInstance()
    // A stand-in for a loaded comment: this tier never opens a file, and what is asserted is
    // that closing a sheet folds a card rather than disposing of the conversation behind it.
    // `destroy()` flushes and disposes of whatever is in the map, so the stub answers both.
    service.sessions.set('k7d2ph', loadedComment())
    const view = mountSheet()

    view.unmount()

    expect(service.open.value).toBeNull()
    expect(service.sessions.get('k7d2ph')).toBeTruthy()
  })

  it('closes when the card is folded from inside it', async () => {
    const view = mountSheet()
    // The sheet expands the card on mount; the watcher has to have seen that before folding
    // means anything, or both changes collapse into one tick that starts and ends at null.
    await nextTick()

    CommentService.getInstance().open.value = null
    await nextTick()

    expect(view.emitted('close')).toHaveLength(1)
  })

  it('gets out of the way when the card it hosts is promoted into a chat', async () => {
    const service = CommentService.getInstance()
    service.sessions.set('k7d2ph', loadedComment())
    const view = mountSheet()
    await nextTick()

    // "Open as chat" and "Open in sidebar" both reveal the sidebar; a sheet left standing
    // covers the very thing that was asked for, and on a phone it covers all of it.
    view.findComponent(CardStub).vm.$emit('promoted')
    await nextTick()

    expect(view.emitted('close')).toHaveLength(1)
    // Promotion moves the conversation; it does not end it.
    expect(service.sessions.get('k7d2ph')).toBeTruthy()
  })

  it('leaves a card that belongs to another marker alone when it closes', () => {
    const service = CommentService.getInstance()
    const view = mountSheet()
    service.open.value = '3mq0xa'

    view.unmount()

    expect(service.open.value).toBe('3mq0xa')
  })
})

/**
 * The visible viewport, which on a phone is not the window.
 *
 * A dialog sized against the window grows under the on-screen keyboard, and the field a person
 * is typing in is the row that goes under it first. `visualViewport` is the only thing that
 * says how much of the window is actually being looked at, so the sheet writes it onto the
 * dialog as two lengths and the stylesheet caps the height with them. None of that can be seen
 * here — happy-dom computes no layout and has no `visualViewport` at all — but the wiring can:
 * the numbers reach the element, they follow the viewport, and they stop when the sheet does.
 */
describe('the comment sheet against the visible viewport', () => {
  /** Enough of a `VisualViewport` to be listened to, and to count who is listening. */
  const fakeViewport = (height: number, offsetTop: number) => {
    const listeners = new Map<string, Set<EventListener>>()
    return {
      height,
      offsetTop,
      listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
      emit(type: string) {
        for (const fn of listeners.get(type) ?? []) fn(new Event(type))
      },
      addEventListener(type: string, fn: EventListener) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(fn)
      },
      removeEventListener(type: string, fn: EventListener) {
        listeners.get(type)?.delete(fn)
      },
    }
  }

  type Viewport = ReturnType<typeof fakeViewport>

  /**
   * Installed on the window the dialog's own element belongs to, which is what the component
   * reads: a modal opened from the settings window lives in that window's document, and the
   * bare global would be the main window's every time.
   */
  const install = (viewport: Viewport | null): void => {
    Object.defineProperty(window, 'visualViewport', {
      value: viewport,
      configurable: true,
      writable: true,
    })
  }

  /** The real kit modal this time: the element the lengths are written on is its own. */
  const mountReal = () =>
    mount(CommentSheet, {
      props: { entry: entry() },
      global: { stubs: { CommentCard: CardStub } },
    })

  const sheetEl = () => document.querySelector('.abele-modal_sheet') as HTMLElement

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).visualViewport
  })

  it('writes what is visible onto the dialog', () => {
    install(fakeViewport(420, 12))

    const view = mountReal()

    expect(sheetEl().style.getPropertyValue('--abele-sheet-height')).toBe('420px')
    expect(sheetEl().style.getPropertyValue('--abele-sheet-offset')).toBe('12px')

    view.unmount()
  })

  it('listens for the viewport changing under it', () => {
    const viewport = fakeViewport(844, 0)
    install(viewport)

    const view = mountReal()

    // Both, and not just `resize`: iOS moves the visible band without resizing it whenever it
    // scrolls a focused field into view, and that arrives as `scroll`.
    expect(viewport.listenerCount()).toBe(2)

    view.unmount()
  })

  it('follows the keyboard up and back down', () => {
    const viewport = fakeViewport(844, 0)
    install(viewport)
    const view = mountReal()

    viewport.height = 420
    viewport.offsetTop = 24
    viewport.emit('resize')

    expect(sheetEl().style.getPropertyValue('--abele-sheet-height')).toBe('420px')
    expect(sheetEl().style.getPropertyValue('--abele-sheet-offset')).toBe('24px')

    viewport.height = 844
    viewport.offsetTop = 0
    viewport.emit('scroll')

    expect(sheetEl().style.getPropertyValue('--abele-sheet-height')).toBe('844px')

    view.unmount()
  })

  it('stops listening when the sheet closes', () => {
    const viewport = fakeViewport(844, 0)
    install(viewport)
    const view = mountReal()

    view.unmount()

    // A dialog that has gone still holding the viewport is a leak per comment opened.
    expect(viewport.listenerCount()).toBe(0)
  })

  it('opens all the same where there is no visible viewport to ask', () => {
    install(null)

    // The desktop of an older Electron, and every test tier: the stylesheet's own fallback
    // takes over, and nothing here may throw on the way.
    expect(() => mountReal().unmount()).not.toThrow()
  })
})
