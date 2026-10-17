import { getIcon, setIcon } from 'obsidian'
import type { MapPlace } from './places'

/**
 * A place's mark on the map and a group's, as elements MapLibre places. A place is a disc of its
 * colour with its Lucide glyph; with no glyph, or one Obsidian does not know, a smaller dot of the
 * same colour, so the place is still there to press. A group is a plate with how many it holds.
 */

export function pinElement(doc: Document, place: MapPlace): HTMLElement {
  const pin = doc.createElement('div')
  pin.className = 'abele-map-base__pin'
  pin.dataset.place = place.id
  pin.setAttribute('role', 'button')
  pin.setAttribute('aria-label', place.title)
  pin.tabIndex = 0
  if (place.color) pin.style.setProperty('--abele-pin-color', place.color)
  const known = !!place.icon && !!getIcon(place.icon)
  if (known) setIcon(pin, place.icon!)
  else pin.classList.add('abele-map-base__pin_dot')
  return pin
}

export function groupElement(doc: Document, count: number, sameSpot: boolean): HTMLElement {
  const group = doc.createElement('div')
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
  if (place.color) el.style.setProperty('--abele-pin-color', place.color)
  if (place.icon && getIcon(place.icon)) setIcon(el, place.icon)
  else el.classList.add('abele-map-base__glyph_dot')
}
