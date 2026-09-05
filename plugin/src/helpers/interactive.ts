/**
 * Whether an event started inside something that is pressed in its own right.
 *
 * A card that opens on click and a table row that selects on click both hold controls of
 * their own — a button, a link, a field — and a press on one of those is that control's, not
 * the container's as well. The walk stops at the container, so a button the whole thing sits
 * inside does not count.
 */
export const INTERACTIVE =
  'button, a, input, select, textarea, [role="button"], [contenteditable], .clickable-icon'

export function fromControl(event: Event): boolean {
  let el = event.target as Element | null
  while (el && el !== event.currentTarget) {
    if (el.matches?.(INTERACTIVE)) return true
    el = el.parentElement
  }
  return false
}
