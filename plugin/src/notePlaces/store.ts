/**
 * Where each note was left: its scroll and its cursor, by path, kept on this device only.
 *
 * The behaviour follows the "Remember cursor position" plugin by Dmitry Savosh
 * (https://github.com/dy-sh/obsidian-remember-cursor-position, MIT): a place per note, saved as
 * the note is read and put back when it is opened again, moved along with a rename and dropped
 * with a delete. The code is written anew; see `register.ts` for what differs.
 */

export interface CursorPlace {
  from: { line: number; ch: number }
  to: { line: number; ch: number }
}

/**
 * A spot in the list under a note: the row that was at the top of the view, by a key that names
 * what it shows (`task:<path>`, `section:tasks`), and how far its top was below the view's top,
 * in pixels (negative when it was partly scrolled past).
 */
export interface AnchorPlace {
  key: string
  offset: number
}

/** A note's place: its scroll as the view reports it, the selection, and when it was saved. */
export interface NotePlace {
  scroll: number
  cursor?: CursorPlace
  /** Set when the view was scrolled into the list under the note: the line alone cannot say where. */
  anchor?: AnchorPlace
  /** Milliseconds since the epoch; the oldest go first when there are too many. */
  at: number
}

/** More than this and the places not visited longest are dropped. */
export const MAX_PLACES = 2000

const isPos = (v: unknown): v is { line: number; ch: number } =>
  !!v &&
  typeof v === 'object' &&
  Number.isFinite((v as { line?: unknown }).line) &&
  Number.isFinite((v as { ch?: unknown }).ch)

function placeFrom(raw: unknown): NotePlace | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.scroll !== 'number' || !Number.isFinite(r.scroll)) return null
  const place: NotePlace = { scroll: r.scroll, at: typeof r.at === 'number' ? r.at : 0 }
  const c = r.cursor as Record<string, unknown> | undefined
  if (c && isPos(c.from) && isPos(c.to))
    place.cursor = {
      from: { line: c.from.line, ch: c.from.ch },
      to: { line: c.to.line, ch: c.to.ch },
    }
  const a = r.anchor as Record<string, unknown> | undefined
  if (
    a &&
    typeof a.key === 'string' &&
    a.key &&
    typeof a.offset === 'number' &&
    Number.isFinite(a.offset)
  )
    place.anchor = { key: a.key, offset: a.offset }
  return place
}

const samePos = (a: { line: number; ch: number }, b: { line: number; ch: number }) =>
  a.line === b.line && a.ch === b.ch

/** Whether two places put the note in the same spot; when each was saved does not count. */
export function samePlace(a: NotePlace | undefined, b: NotePlace | undefined): boolean {
  if (!a || !b) return a === b
  if (a.scroll !== b.scroll) return false
  if (a.anchor?.key !== b.anchor?.key || a.anchor?.offset !== b.anchor?.offset) return false
  if (!a.cursor || !b.cursor) return !a.cursor && !b.cursor
  return samePos(a.cursor.from, b.cursor.from) && samePos(a.cursor.to, b.cursor.to)
}

const under = (path: string, folder: string) => path.startsWith(folder + '/')

export class NotePlaces {
  private places: Record<string, NotePlace>

  private constructor(places: Record<string, NotePlace>) {
    this.places = places
  }

  /** From what was stored, whatever it holds: anything that is not a place is left out. */
  static from(raw: unknown): NotePlaces {
    const places: Record<string, NotePlace> = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
        const place = placeFrom(value)
        if (place) places[path] = place
      }
    return new NotePlaces(places)
  }

  get size(): number {
    return Object.keys(this.places).length
  }

  get(path: string): NotePlace | undefined {
    return this.places[path]
  }

  /** Saves where `path` is now. Says whether anything changed. */
  remember(path: string, place: NotePlace): boolean {
    if (!Number.isFinite(place.scroll)) return false
    if (samePlace(this.places[path], place)) return false
    this.places[path] = place
    return true
  }

  /** A note, or a folder and all under it, deleted. Says whether anything was dropped. */
  forget(path: string): boolean {
    let changed = false
    for (const key of Object.keys(this.places))
      if (key === path || under(key, path)) {
        delete this.places[key]
        changed = true
      }
    return changed
  }

  /** A note, or a folder and all under it, renamed or moved. Says whether anything moved. */
  rename(from: string, to: string): boolean {
    let changed = false
    for (const key of Object.keys(this.places)) {
      const moved = key === from ? to : under(key, from) ? to + key.slice(from.length) : null
      if (moved === null) continue
      this.places[moved] = this.places[key]
      delete this.places[key]
      changed = true
    }
    return changed
  }

  /**
   * Places of notes that no longer exist dropped, and past `max` those visited longest ago.
   * Says whether anything was dropped.
   */
  prune(exists: (path: string) => boolean, max = MAX_PLACES): boolean {
    let changed = false
    for (const key of Object.keys(this.places))
      if (!exists(key)) {
        delete this.places[key]
        changed = true
      }
    const keys = Object.keys(this.places)
    if (keys.length > max) {
      keys.sort((a, b) => this.places[b].at - this.places[a].at)
      for (const key of keys.slice(max)) delete this.places[key]
      changed = true
    }
    return changed
  }

  toJSON(): Record<string, NotePlace> {
    return { ...this.places }
  }
}
