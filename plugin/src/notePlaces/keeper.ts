/**
 * The decisions behind putting a note back where it was left, apart from Obsidian's views so
 * they can be tested: when a place is saved, when it is put back, and when it must not be.
 *
 * - A note opened plainly — from the file list, the quick switcher, a link with no heading or
 *   block in it — comes back at its saved place.
 * - A note opened at a place of someone's choosing — a heading, a block, a search result, a
 *   backlink's line, the line a book's highlight is on — goes there, and the saved place is not
 *   put back, then or a moment later. That is what the moment later is for: a place asked for
 *   just after the note opened (the reader opens the note, then scrolls it to the highlight)
 *   still cancels the restore waiting to happen.
 * - A view's place is saved only once its note has settled — put back, or left where it was
 *   asked to go. Before that it shows the top of a note on its way somewhere else, and saving it
 *   would overwrite the place about to be put back.
 */
import { NotePlaces, type NotePlace } from './store'

/** A place as a view reports it; when it was saved is added here. */
export type ViewPlace = Omit<NotePlace, 'at'>

/** What the keeper needs of a view: its note, its place, and a way to put a place back. */
export interface PlaceIo<V> {
  path(view: V): string | null
  /** Null while the view is not on screen: a hidden scroller reports the top, whatever it holds. */
  place(view: V): ViewPlace | null
  apply(view: V, place: NotePlace): void
}

export interface KeeperEnv {
  enabled(): boolean
  now(): number
  schedule(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
  load(): unknown
  save(value: unknown): void
}

/** How soon after a note opens its place is put back, and how often it is checked again. */
export const RESTORE_STEP_MS = 50
/**
 * How long a restore keeps trying: a note just opened is laid out over the first moments, and a
 * scroll made before that lands short. Past this it is left where it got to.
 */
export const RESTORE_WINDOW_MS = 1500
/** How often a view not on screen is looked at again, and for how long before it is let go. */
export const HIDDEN_STEP_MS = 250
export const HIDDEN_WAIT_MS = 10 * 60 * 1000
/** A scroll this close, in the view's own units (lines), is the place. */
const CLOSE_ENOUGH = 0.5
/** How long a change waits before it is written, so scrolling does not write on every step. */
export const SAVE_DELAY_MS = 2000

interface Pending {
  path: string
  place: NotePlace
  waited: number
  /** How long it has waited, off screen, to be shown. */
  hidden: number
  handle: unknown
}

const atTop = (p: ViewPlace) =>
  p.scroll === 0 &&
  (!p.cursor ||
    (p.cursor.from.line === 0 &&
      p.cursor.from.ch === 0 &&
      p.cursor.to.line === 0 &&
      p.cursor.to.ch === 0))

export class NotePlaceKeeper<V extends object> {
  readonly places: NotePlaces
  private pending = new Map<V, Pending>()
  /** The note each view has settled on; its place may be saved while it still shows that note. */
  private settled = new WeakMap<V, string>()
  /** True while a place is being put back, so that scroll is not taken for someone's jump. */
  private applying = false
  private saveHandle: unknown = null

  constructor(
    private io: PlaceIo<V>,
    private env: KeeperEnv
  ) {
    this.places = NotePlaces.from(env.load())
  }

  /** `view` has just loaded `path`; `explicit` when it was asked to go to a place in it. */
  opened(view: V, path: string, explicit: boolean): void {
    this.drop(view)
    const saved = this.env.enabled() && !explicit ? this.places.get(path) : undefined
    if (!saved) {
      this.settled.set(view, path)
      return
    }
    this.settled.delete(view)
    const pending: Pending = { path, place: saved, waited: 0, hidden: 0, handle: null }
    this.pending.set(view, pending)
    pending.handle = this.env.schedule(() => this.attempt(view), RESTORE_STEP_MS)
  }

  /**
   * Someone took `view` to a place of their own: a restore still waiting is called off. Our own
   * restore scrolling the view does not count.
   */
  claim(view: V): void {
    if (this.applying) return
    const was = this.pending.get(view)
    this.drop(view)
    const path = this.io.path(view) ?? was?.path
    if (path) this.settled.set(view, path)
  }

  /** Whether a restore is waiting to happen in `view`. */
  isPending(view: V): boolean {
    return this.pending.has(view)
  }

  private drop(view: V): void {
    const p = this.pending.get(view)
    if (!p) return
    this.env.cancel(p.handle)
    this.pending.delete(view)
  }

  private attempt(view: V): void {
    const p = this.pending.get(view)
    if (!p) return
    // The view moved on to another note meanwhile: that opening has its own say.
    if (this.io.path(view) !== p.path) {
      this.pending.delete(view)
      return
    }
    const now = this.io.place(view)
    // Not on screen — a tab opened behind the one in front: it is put back once it shows.
    if (!now && p.hidden < HIDDEN_WAIT_MS && this.env.enabled()) {
      p.hidden += HIDDEN_STEP_MS
      p.handle = this.env.schedule(() => this.attempt(view), HIDDEN_STEP_MS)
      return
    }
    const arrived = !!now && Math.abs(now.scroll - p.place.scroll) <= CLOSE_ENOUGH
    if (arrived || p.waited >= RESTORE_WINDOW_MS || !this.env.enabled()) {
      this.pending.delete(view)
      this.settled.set(view, p.path)
      return
    }
    this.applying = true
    try {
      this.io.apply(view, p.place)
    } catch (e) {
      console.warn('[Abele] could not put the note back where it was left', e)
      this.pending.delete(view)
      this.settled.set(view, p.path)
      return
    } finally {
      this.applying = false
    }
    p.waited += RESTORE_STEP_MS
    p.handle = this.env.schedule(() => this.attempt(view), RESTORE_STEP_MS)
  }

  /** Saves where `view` is, if its note has settled. A note never moved from its top is skipped. */
  sample(view: V): void {
    if (!this.env.enabled()) return
    const path = this.io.path(view)
    if (!path || this.settled.get(view) !== path) return
    const place = this.io.place(view)
    if (!place) return
    if (!this.places.get(path) && atTop(place)) return
    if (this.places.remember(path, { ...place, at: this.env.now() })) this.changed()
  }

  renamed(from: string, to: string): void {
    if (this.places.rename(from, to)) this.changed()
  }

  deleted(path: string): void {
    if (this.places.forget(path)) this.changed()
  }

  prune(exists: (path: string) => boolean): void {
    if (this.places.prune(exists)) this.changed()
  }

  /** Places brought over from elsewhere; a note that has one here already keeps its own. */
  adopt(places: Record<string, NotePlace>): number {
    let taken = 0
    for (const [path, place] of Object.entries(places))
      if (!this.places.get(path) && this.places.remember(path, place)) taken++
    if (taken) this.changed()
    return taken
  }

  private changed(): void {
    if (this.saveHandle !== null) return
    this.saveHandle = this.env.schedule(() => this.flush(), SAVE_DELAY_MS)
  }

  /** Writes what changed now, rather than after the delay; nothing changed writes nothing. */
  flush(): void {
    if (this.saveHandle === null) return
    this.env.cancel(this.saveHandle)
    this.saveHandle = null
    this.env.save(this.places.toJSON())
  }

  /** Every restore still waiting called off, for the plugin's unload. */
  stop(): void {
    for (const view of [...this.pending.keys()]) this.drop(view)
  }
}
