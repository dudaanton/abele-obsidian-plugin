/**
 * What the Bases map view draws: a place per note that has coordinates, the notes it had to leave
 * out and why, and the plain arithmetic the view needs on top (nearby groups, straight-line
 * distance). No Obsidian API here: the view's adapter turns a base's entries into these.
 */

export type MapPlaceProperty = { name: string; value: string }

export type MapPlacePhoto = { path: string; url: string; caption?: string; missing?: boolean }

export type MapPlace = {
  id: string
  /** The note's path: what opening, previewing and the menu act on. */
  path: string
  title: string
  lat: number
  lon: number
  /** A Lucide name as Obsidian draws it; absent or unknown draws a plain dot. */
  icon?: string
  /** A CSS colour or a theme variable; absent or unreadable takes the theme's accent. */
  color?: string
  /** The view's chosen properties, already rendered as text, in the view's order. */
  properties: MapPlaceProperty[]
  photos?: MapPlacePhoto[]
  /** The note's text, for the card. */
  text?: string
}

/** Why a note of the base is not on the map. */
export type MapSkipReason = 'no-coordinates' | 'unreadable' | 'formula-error'

export type MapSkipped = { path: string; title: string; reason: MapSkipReason; detail?: string }
