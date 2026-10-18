import { getIcon, setIcon } from 'obsidian'
import type { MapPlace } from './places'

/**
 * A place's mark on the map and a group's, as elements MapLibre places. A place is a disc of its
 * colour with its Lucide glyph; with no glyph, or one Obsidian does not know, a smaller dot of the
 * same colour, so the place is still there to press. A group is a plate with how many it holds.
 */

export function pinElement(
  doc: Document,
  place: MapPlace,
  activate?: (event: MouseEvent) => void
): HTMLElement {
  const pin = doc.win.createDiv()
  pin.className = 'abele-map-base__pin'
  pin.dataset.place = place.id
  pin.setAttribute('role', 'button')
  pin.setAttribute('aria-label', place.title)
  pin.tabIndex = 0
  applyColor(pin, place.color)
  const known = !!place.icon && !!getIcon(place.icon)
  if (known) setIcon(pin, place.icon)
  else pin.classList.add('abele-map-base__pin_dot')
  if (activate) {
    pin.addEventListener('click', (event) => {
      event.stopPropagation()
      activate(event)
    })
    pin.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      pin.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        })
      )
    })
  }
  return pin
}

export function groupElement(doc: Document, count: number, sameSpot: boolean): HTMLElement {
  const group = doc.win.createDiv()
  group.className = 'abele-map-base__group'
  group.setAttribute('role', 'button')
  group.tabIndex = 0
  group.setAttribute('aria-label', sameSpot ? `${count} places at one spot` : `${count} places`)
  group.classList.add(
    count < 10
      ? 'abele-map-base__group_s'
      : count < 100
        ? 'abele-map-base__group_m'
        : 'abele-map-base__group_l'
  )
  if (sameSpot) group.classList.add('abele-map-base__group_spot')
  group.textContent = String(count)
  return group
}

/** The same disc, small, at the start of a list row: the row and its mark read as one thing. */
export function placeGlyph(el: HTMLElement, place: MapPlace): void {
  el.empty?.()
  el.className = 'abele-map-base__glyph'
  applyColor(el, place.color)
  if (place.icon && getIcon(place.icon)) setIcon(el, place.icon)
  else el.classList.add('abele-map-base__glyph_dot')
}

/** A missing or malformed colour falls back to the theme, including after a live update. */
function applyColor(el: HTMLElement, color?: string): void {
  el.style.removeProperty('--abele-pin-color')
  const probe = el.ownerDocument.win.createSpan()
  if (color) probe.style.color = color
  if (color && probe.style.color) el.style.setProperty('--abele-pin-color', color)
}
