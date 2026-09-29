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
import { NotePlaces, type AnchorPlace, type NotePlace } from './store'

/** A place as a view reports it; when it was saved is added here. */
export type ViewPlace = Omit<NotePlace, 'at'>

/** What the keeper needs of a view: its note, its place, and a way to put a place back. */
export interface PlaceIo<V> {
  path(view: V): string | null
  /** Null while the view is not on screen: a hidden scroller reports the top, whatever it holds. */
  place(view: V): ViewPlace | null
  /**
   * Scrolls `view` to `place`. `first` on the first try only: the cursor is put back then and
   * never again — in live preview each selection redraws the lines around it, and doing it on
   * every try made the note shake.
   */
  apply(view: V, place: NotePlace, first: boolean): void
  /** Whether `view` is scrolled as far down as it goes: a place further down cannot be reached. */
  atEnd(view: V): boolean
  /**
   * Calls `onInput` when the person scrolls, touches, clicks or types in `view` themselves; the
   * result stops listening.
   */
  watchInput(view: V, onInput: () => void): () => void
  /**
   * Scrolls `view` so the row `anchor` names is where it was, if that row is drawn. Says whether
   * it was: the list under a note is drawn a moment after the note, and its rows after that.
   */
  alignAnchor(view: V, anchor: AnchorPlace): boolean
  /**
   * Keeps the row where it is while what is around it is still being drawn, correcting before
   * anything is painted; the result stops.
   */
  holdAnchor(view: V, anchor: AnchorPlace): () => void
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
const CLOSE_ENOUGH = 1
/**
 * How many times a scroll that landed, but short, is made again. A note that grows above the
 * place as it renders — embeds, diagrams, tables measured late — moves it each time it is
 * measured again; chasing that for as long as it grows is what made the note shake. Past these
 * few it is left where it is.
 */
export const MAX_CORRECTIONS = 2
/** How long a restore waits for the row it was left at to be drawn under the note. */
export const ANCHOR_WAIT_MS = 4000
/** How long that row is then held in place while the rest of the list is drawn around it. */
export const ANCHOR_HOLD_MS = 1500
/** How long a change waits before it is written, so scrolling does not write on every step. */
export const SAVE_DELAY_MS = 2000

interface Pending {
  path: string
  place: NotePlace
  waited: number
  /** How long it has waited, off screen, to be shown. */
  hidden: number
  handle: unknown
  /** How many times the place was applied. */
  applied: number
  /** The scroll the view reported just before the last apply. */
  before: number | null
  /** Whether an apply has moved the view yet: until then it was not ready for one. */
  landed: boolean
  /** Stops listening for the person's own scrolling, and holding the row in place. */
  unwatch: () => void
  /** Past the line, looking for the row under the note: how long it has looked. */
  anchorWaited: number | null
}

const atTop = (p: ViewPlace) =>
  !p.anchor &&
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
    // Saved at its top is where a note opens anyway: nothing to put back, nothing to move.
    if (!saved || atTop(saved)) {
      this.settled.set(view, path)
      return
    }
    this.settled.delete(view)
    const pending: Pending = {
      path,
      place: saved,
      waited: 0,
      hidden: 0,
      handle: null,
      applied: 0,
      before: null,
      landed: false,
      unwatch: () => {},
      anchorWaited: null,
    }
    this.pending.set(view, pending)
    // The person scrolling, touching or typing first: the note stays where they took it.
    pending.unwatch = this.io.watchInput(view, () => this.claim(view))
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
    p.unwatch()
    this.pending.delete(view)
  }

  /** The restore of `view` done with, whether it landed or not: its place may be saved now. */
  private finish(view: V, p: Pending): void {
    p.unwatch()
    this.pending.delete(view)
    this.settled.set(view, p.path)
  }

  /**
   * The line reached, the row under the note it was left at: waited for until it is drawn, put
   * where it was once, then held there while the list finishes drawing — never chased step by
   * step, which is what shakes.
   */
  private anchorStep(view: V, p: Pending): void {
    const anchor = p.place.anchor
    if (this.io.path(view) !== p.path || !this.env.enabled()) {
      this.finish(view, p)
      return
    }
    let found = false
    this.applying = true
    try {
      found = this.io.alignAnchor(view, anchor)
    } catch (e) {
      console.warn('[Abele] could not bring back the row under the note', e)
      this.finish(view, p)
      return
    } finally {
      this.applying = false
    }
    if (!found) {
      if (p.anchorWaited >= ANCHOR_WAIT_MS) {
        this.finish(view, p)
        return
      }
      p.anchorWaited += RESTORE_STEP_MS
      p.handle = this.env.schedule(() => this.anchorStep(view, p), RESTORE_STEP_MS)
      return
    }
    const unwatch = p.unwatch
    const release = this.io.holdAnchor(view, anchor)
    p.unwatch = () => {
      release()
      unwatch()
    }
    p.handle = this.env.schedule(() => this.finish(view, p), ANCHOR_HOLD_MS)
  }

  private attempt(view: V): void {
    const p = this.pending.get(view)
    if (!p) return
    // The view moved on to another note meanwhile: that opening has its own say.
    if (this.io.path(view) !== p.path) {
      p.unwatch()
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
    // The last scroll moved the view: it was ready for it. One that did not — reading view not
    // measured yet — is no jump on screen, and is simply tried again.
    const moved = p.applied > 0 && !!now && p.before !== null && now.scroll !== p.before
    // Landed once and this try changed nothing: it is as close as this note lets it get.
    const stuck = p.landed && !moved
    if (moved) p.landed = true
    const done =
      arrived ||
      !now ||
      stuck ||
      (p.applied > 0 && this.io.atEnd(view)) ||
      (p.landed && p.applied > MAX_CORRECTIONS) ||
      p.waited >= RESTORE_WINDOW_MS ||
      !this.env.enabled()
    if (done) {
      if (p.place.anchor && now && this.env.enabled()) {
        p.anchorWaited = 0
        this.anchorStep(view, p)
      } else this.finish(view, p)
      return
    }
    p.before = now.scroll
    this.applying = true
    try {
      this.io.apply(view, p.place, p.applied === 0)
      p.applied++
    } catch (e) {
      console.warn('[Abele] could not put the note back where it was left', e)
      this.finish(view, p)
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
