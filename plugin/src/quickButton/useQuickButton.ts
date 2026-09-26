/**
 * Everything the quick button watches to know whether it is there, whether it is tucked away,
 * and where it rests. `QuickButton.vue` draws it and handles the finger.
 *
 * The page is read, not told: where a field has focus, whether words are selected, whether a
 * dialog or a drawer is open, what is at the bottom of the screen. So a new dialog or bar
 * elsewhere in the plugin needs nothing from here to be respected — as long as it is a dialog,
 * or named among the obstacles in `context.ts`.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import { Platform, type App, type EventRef, type View } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { KEYBOARD_EVENTS, TYPED, keyboardVar } from '@/composables/useKeyboardRoom'
import { safeAreaBottom } from '@/composables/keyboardLift'
import { quickButtonSettingsFrom } from './settings'
import { boxOf, obstacles, quickContext, type QuickContext } from './context'
import { buttonTop, restLine } from './placement'
import { ScrollWatch, goneReason, type QuickPlatform } from './visibility'

/** A view that can say it is busy, or how far into itself the reader is. */
interface QuickAware {
  quickButtonBusy?: () => boolean
  quickButtonProgress?: () => number | null
  /** The view is read to the edges of the screen: the button rests tucked away there. */
  quickButtonTucked?: () => boolean
}

const aware = (view: View | null): QuickAware => (view ?? {}) as QuickAware

const platformNow = (): QuickPlatform =>
  Platform.isPhone ? 'phone' : Platform.isMobile ? 'tablet' : 'desktop'

/** How long a book that has just come to the front is left to find its place. */
const SETTLING_MS = 2000

/** The scroll, in pixels taken together, that tucks the button away or brings it back. */
const SCROLL_STEP = 32

/** A theme's spacing step as a number of pixels, for arithmetic. */
function step(doc: Document, name: string, fallback: number): number {
  const value = parseFloat(doc.defaultView?.getComputedStyle(doc.body).getPropertyValue(name) ?? '')
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function useQuickButton(app: App, button: Ref<HTMLElement | null | undefined>) {
  const config = AbeleConfig.getInstance()
  const doc = document
  const settings = computed(() => {
    void config.version.value
    return quickButtonSettingsFrom(config.quickButton)
  })

  const context = shallowRef<QuickContext>({ view: null, drawer: 'closed' })
  const typing = ref(false)
  const keyboard = ref(0)
  const selection = ref(false)
  const dialog = ref(false)
  const hiddenNav = ref(false)
  /** Tucked away by a scroll down or a page turned forward. */
  const scrolledAway = ref(false)
  const platform = platformNow()

  const busy = computed(() => {
    const view = aware(context.value.view)
    return typeof view.quickButtonBusy === 'function' ? !!view.quickButtonBusy() : false
  })

  const gone = computed(() =>
    goneReason({
      enabled: settings.value.enabled,
      platform,
      tablet: settings.value.tablet,
      typing: typing.value,
      keyboard: keyboard.value,
      selection: selection.value,
      dialog: dialog.value,
      drawer: context.value.drawer,
      viewBusy: busy.value,
    })
  )

  const restsTucked = computed(() => {
    const view = aware(context.value.view)
    return typeof view.quickButtonTucked === 'function' ? !!view.quickButtonTucked() : false
  })

  const tucked = computed(() => scrolledAway.value || hiddenNav.value || restsTucked.value)

  /**
   * The home indicator's height. Measured by an element put on the page and taken off, which the
   * page's own watcher would hear — so once, and again only when the window changes size.
   */
  let insetBottom = 0
  const measureInsets = () => {
    insetBottom = safeAreaBottom(doc)
  }

  /** The line it last rested on, for the drag to measure its lift from. */
  const line = ref(0)

  const place = () => {
    const el = button.value
    if (!el || gone.value) return
    const size = el.offsetHeight || 52
    const gap = step(doc, '--size-4-3', 12)
    const column = { left: el.offsetLeft, right: el.offsetLeft + size }
    const shown = obstacles(doc, context.value.view).filter((o) => o.getClientRects().length > 0)
    // Above the home indicator where nothing else is at the bottom — a tablet has no navigation bar.
    const bottom = window.innerHeight - insetBottom
    line.value = restLine(shown.map(boxOf), column, bottom)
    const header = context.value.view?.containerEl.querySelector<HTMLElement>('.view-header')
    const ceiling = Math.max(0, header ? header.getBoundingClientRect().bottom : 0) + gap
    const top = buttonTop({ line: line.value, size, gap, lift: settings.value.lift, ceiling })
    el.style.setProperty('--abele-floating-button-top', `${top}px`)
  }

  let frame = 0
  const schedule = () => {
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      place()
    })
  }

  const scroll = new ScrollWatch(SCROLL_STEP)
  /** When the view in front last changed. */
  let arrivedAt = 0
  const refreshContext = () => {
    const next = quickContext(app)
    if (next.view !== context.value.view) {
      arrivedAt = Date.now()
      scroll.reset()
      scrolledAway.value = false
    }
    if (next.view !== context.value.view || next.drawer !== context.value.drawer)
      context.value = next
    schedule()
  }

  /**
   * Whether the keyboard is up. Obsidian's iPhone app says so itself, writing its height and
   * taking it away again — and there the editor can keep its focus with the keyboard put away,
   * so once that height has been seen it is the only word taken. Elsewhere (Android, the
   * emulator) a field with focus is what brings the keyboard up.
   */
  let heightSeen = false
  const readTyping = () => {
    const active = doc.activeElement as HTMLElement | null
    const focused = !!active && active !== doc.body && active.matches(TYPED)
    typing.value = focused && !heightSeen
  }
  const readKeyboard = () => {
    keyboard.value = keyboardVar(doc)
    if (keyboard.value > 0) heightSeen = true
    readTyping()
  }
  const readSelection = () => {
    const sel = doc.getSelection()
    const inside = sel?.anchorNode ? button.value?.contains(sel.anchorNode) : false
    selection.value = !!sel && !sel.isCollapsed && sel.rangeCount > 0 && !inside
  }
  const readBody = () => {
    dialog.value = !!doc.body.querySelector(':scope > .modal-container')
    hiddenNav.value = doc.body.classList.contains('is-hidden-nav')
    refreshContext()
  }

  /** Each scroller gets a key of its own, so a list beside the page does not add to it. */
  const keys = new WeakMap<EventTarget, string>()
  let nextKey = 0
  const onScroll = (event: Event) => {
    const target = event.target as HTMLElement | Document | null
    const el = target instanceof HTMLElement ? target : null
    const root = context.value.view?.containerEl
    if (!el || !root || !root.contains(el)) return
    let key = keys.get(el)
    if (!key) keys.set(el, (key = `s${nextKey++}`))
    const said = scroll.feed(key, el.scrollTop)
    if (said) scrolledAway.value = said === 'tuck'
  }

  // A book is read by turning pages, not by scrolling: forward tucks it, back brings it back.
  // Not in the first moments a book is in front, while it opens at the place it was left.
  watch(
    () => {
      const view = context.value.view
      const progress = aware(view).quickButtonProgress
      const at = typeof progress === 'function' ? progress.call(view) : null
      return { view, at: typeof at === 'number' ? at : null }
    },
    (now, before) => {
      if (now.view !== before?.view || now.at === null || before?.at == null) return
      if (Date.now() - arrivedAt < SETTLING_MS) return
      if (now.at > before.at + 1e-4) scrolledAway.value = true
      else if (now.at < before.at - 1e-4) scrolledAway.value = false
      else return
      scroll.note(scrolledAway.value ? 'tuck' : 'show')
    }
  )

  watch([gone, tucked, () => settings.value.lift, () => settings.value.side], () => schedule(), {
    flush: 'post',
  })

  const onResize = () => {
    measureInsets()
    refreshContext()
  }

  const events: EventRef[] = []
  const bodyWatch = new MutationObserver(readBody)
  const rootWatch = new MutationObserver(readKeyboard)
  let timer = 0

  onMounted(() => {
    const { workspace } = app
    events.push(workspace.on('active-leaf-change', refreshContext))
    events.push(workspace.on('layout-change', refreshContext))
    for (const name of KEYBOARD_EVENTS) window.addEventListener(name, readKeyboard)
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', schedule)
    doc.addEventListener('focusin', readTyping)
    doc.addEventListener('focusout', readTyping)
    doc.addEventListener('selectionchange', readSelection)
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true })
    bodyWatch.observe(doc.body, { childList: true, attributes: true, attributeFilter: ['class'] })
    rootWatch.observe(doc.documentElement, { attributes: true, attributeFilter: ['style'] })
    // Bars come and go inside views with nothing announced — a book's selection bar, a chat's
    // composer growing a line. Reading where things stand once a second costs a few rectangles.
    timer = window.setInterval(() => {
      if (!gone.value) refreshContext()
    }, 1000)
    measureInsets()
    readKeyboard()
    readSelection()
    readBody()
  })

  onBeforeUnmount(() => {
    for (const ref of events) app.workspace.offref(ref)
    for (const name of KEYBOARD_EVENTS) window.removeEventListener(name, readKeyboard)
    window.removeEventListener('resize', onResize)
    window.visualViewport?.removeEventListener('resize', schedule)
    doc.removeEventListener('focusin', readTyping)
    doc.removeEventListener('focusout', readTyping)
    doc.removeEventListener('selectionchange', readSelection)
    doc.removeEventListener('scroll', onScroll, { capture: true })
    bodyWatch.disconnect()
    rootWatch.disconnect()
    window.clearInterval(timer)
    if (frame) window.cancelAnimationFrame(frame)
  })

  /** Pressed while tucked: it comes back, the menu opening over it. */
  const untuck = () => {
    scrolledAway.value = false
    scroll.note('show')
  }

  return { settings, gone, tucked, line, place, schedule, untuck, context }
}
