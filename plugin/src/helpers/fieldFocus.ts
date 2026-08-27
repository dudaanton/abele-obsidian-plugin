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
const KEEPS_FOCUS = '.suggestion-container, .menu, .prompt'

/** Everything this plugin renders is under a class of its own. Nothing of Obsidian's is. */
const OURS = '[class*="abele-"]'

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

/**
 * Releases the focus of one of the plugin's fields when a touch starts outside it.
 *
 * `touchstart` rather than a pointer event on purpose: it is raised only by a touchscreen, so
 * a desktop never reaches this code and its selection behaviour is untouched. The listener is
 * passive — nothing here cancels anything — and capturing, so it runs before a handler that
 * stops the event from propagating can hide the tap.
 */
export function registerFocusRelease(plugin: Plugin): void {
  plugin.registerDomEvent(
    document,
    'touchstart',
    (event) => {
      const target = event.target
      const active = document.activeElement
      if (!(target instanceof Element)) return
      if (!releasesFocus(target, active)) return
      ;(active as HTMLElement).blur()
    },
    { capture: true, passive: true }
  )
}
