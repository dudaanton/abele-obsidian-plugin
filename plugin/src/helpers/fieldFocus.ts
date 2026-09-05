import type { Plugin } from 'obsidian'

/**
 * Giving up a field's focus when the user taps somewhere else.
 *
 * On a desktop this needs no help: pressing a non-focusable element is a focus change, and
 * the browser performs it. On a phone it does not happen — Obsidian sets `user-select: none`
 * across its whole interface, and a tap on an area that is neither selectable nor clickable
 * has no default action to perform, so the field keeps focus and the on-screen keyboard stays
 * up. It is the app's behaviour rather than this plugin's: Obsidian's own fields do the same,
 * and being asked to close the keyboard by tapping elsewhere is an open request on its forum.
 *
 * So this releases the focus itself, and only where the plugin is entitled to: a field of its
 * own, in its own interface. Obsidian's fields are left exactly as Obsidian leaves them.
 */

/** What holds a keyboard open while focused. */
const FIELD = 'input, textarea, select, [contenteditable="true"]'

/**
 * Surfaces that a tap must be able to reach without the field losing focus first.
 *
 * A suggester is the case that matters: Obsidian's `AbstractInputSuggest` closes its list on
 * the input's `blur`, so releasing focus when a suggestion is pressed would take the list
 * away before the press could choose from it. Obsidian defends the same boundary from its
 * side, by cancelling the default action of a press on a suggestion.
 */
const KEEPS_FOCUS = '.suggestion-container, .menu, .prompt, .mobile-toolbar'

/**
 * Everything this plugin renders is under a class of its own — but so, on a phone, is the
 * whole app: the plugin puts `abele-full-width-sidebars` on `<body>`, which is an ancestor of
 * every field in Obsidian. Matching it made every field in the app look like one of ours, so
 * typing in a note and reaching for the toolbar above the keyboard released the editor's
 * focus and the keyboard went down with it, taking the tap with it.
 */
const OURS = '[class*="abele-"]:not(body):not(html)'

/**
 * Whether a touch landing on `target` should take focus away from `active`.
 *
 * Split out from the listener because this is the whole of the decision, and it is the part
 * worth being sure about: too eager and it closes a suggester mid-choice, too shy and the
 * keyboard stays up.
 */
export function releasesFocus(target: Element | null, active: Element | null): boolean {
  if (!target || !active || !active.matches(FIELD)) return false
  // Only this plugin's own fields. Obsidian's are its own business.
  if (!active.closest(OURS)) return false
  if (active === target || active.contains(target)) return false
  // A press on another field moves the focus by itself, and one on a suggestion needs the
  // focus kept where it is.
  if (target.closest(FIELD) || target.closest(KEEPS_FOCUS)) return false
  return true
}

/** How far a finger may travel between touching and lifting and still have tapped. */
export const TAP_SLOP_PX = 10

/**
 * Releases the focus of one of the plugin's fields when a tap lands outside it.
 *
 * A tap, decided when the finger lifts, not a touch, decided when it lands: a scroll starts
 * with the same `touchstart`, and releasing on that closed the keyboard the moment a reader
 * tried to scroll the conversation up to see what they were answering (2026-09-05, from the
 * phone). So the touch is remembered where it landed, and the focus goes on `touchend` only if
 * the finger has stayed within a tap of that point. A `touchcancel` — the system taking the
 * gesture — forgets it.
 *
 * Touch events rather than pointer events on purpose: they are raised only by a touchscreen,
 * so a desktop never reaches this code and its selection behaviour is untouched. The listeners
 * are passive — nothing here cancels anything — and capturing, so they run before a handler
 * that stops the event from propagating can hide the tap.
 */
export function registerFocusRelease(plugin: Plugin): void {
  let began: { x: number; y: number; active: HTMLElement } | null = null
  const options = { capture: true, passive: true }

  plugin.registerDomEvent(
    document,
    'touchstart',
    (event) => {
      began = null
      const target = event.target
      const active = document.activeElement
      if (!(target instanceof Element)) return
      if (!releasesFocus(target, active)) return
      const touch = event.touches?.[0]
      began = { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0, active: active as HTMLElement }
    },
    options
  )

  plugin.registerDomEvent(
    document,
    'touchend',
    (event) => {
      const tap = began
      began = null
      if (!tap) return
      const touch = event.changedTouches?.[0]
      if (touch && Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > TAP_SLOP_PX) return
      // Still the field that was focused when the finger landed — a press on another field
      // in between has already moved the focus itself.
      if (document.activeElement !== tap.active) return
      tap.active.blur()
    },
    options
  )

  plugin.registerDomEvent(
    document,
    'touchcancel',
    () => {
      began = null
    },
    options
  )
}
