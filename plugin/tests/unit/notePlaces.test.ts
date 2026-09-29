/**
 * Notes come back where they were left — unless they are opened at a place of their own.
 *
 * The store (what is kept, moved, dropped), the reading of an opening's ephemeral state (a
 * place asked for, or not), and the keeper's decisions: a plain opening gets its saved place, a
 * place asked for wins — also when it is asked for just after the note opened — and a view is
 * not saved while it still shows the top of a note on its way to its place.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NotePlaces, MAX_PLACES, type NotePlace } from '@/notePlaces/store'
import { isExplicitTarget } from '@/notePlaces/target'
import {
  NotePlaceKeeper,
  RESTORE_STEP_MS,
  HIDDEN_STEP_MS,
  HIDDEN_WAIT_MS,
  MAX_CORRECTIONS,
  ANCHOR_HOLD_MS,
  ANCHOR_WAIT_MS,
  RESTORE_WINDOW_MS,
  SAVE_DELAY_MS,
  type PlaceIo,
  type ViewPlace,
} from '@/notePlaces/keeper'
import { placesFromRememberCursor } from '@/notePlaces/otherPlugin'
import { MarkdownView } from 'obsidian'

const at = (scroll: number, time = 1): NotePlace => ({ scroll, at: time })

describe('the places kept', () => {
  it('reads only what is a place from what was stored', () => {
    const s = NotePlaces.from({
      'a.md': { scroll: 12, at: 5 },
      'b.md': { scroll: 'x' },
      'c.md': null,
      'd.md': { scroll: 3, cursor: { from: { line: 1, ch: 2 }, to: { line: 1, ch: 4 } } },
      'e.md': { scroll: 3, cursor: { from: { line: 1 } } },
    })
    expect(Object.keys(s.toJSON()).sort()).toEqual(['a.md', 'd.md', 'e.md'])
    expect(s.get('d.md')?.cursor).toEqual({ from: { line: 1, ch: 2 }, to: { line: 1, ch: 4 } })
    expect(s.get('e.md')?.cursor).toBeUndefined()
    expect(NotePlaces.from('junk').size).toBe(0)
    expect(NotePlaces.from([1, 2]).size).toBe(0)
  })

  it('says whether remembering changed anything; the time alone does not', () => {
    const s = NotePlaces.from({})
    expect(s.remember('a.md', at(10, 1))).toBe(true)
    expect(s.remember('a.md', at(10, 2))).toBe(false)
    expect(s.remember('a.md', at(11, 3))).toBe(true)
    expect(s.remember('a.md', at(NaN))).toBe(false)
  })

  it('moves a note, and a folder with everything under it, on a rename', () => {
    const s = NotePlaces.from({
      'dir/a.md': at(1),
      'dir/sub/b.md': at(2),
      'dirt.md': at(3),
      'other.md': at(4),
    })
    expect(s.rename('dir', 'moved')).toBe(true)
    expect(Object.keys(s.toJSON()).sort()).toEqual([
      'dirt.md',
      'moved/a.md',
      'moved/sub/b.md',
      'other.md',
    ])
    expect(s.rename('other.md', 'renamed.md')).toBe(true)
    expect(s.get('renamed.md')?.scroll).toBe(4)
    expect(s.rename('nowhere.md', 'x.md')).toBe(false)
  })

  it('drops a note, and a folder with everything under it, on a delete', () => {
    const s = NotePlaces.from({ 'dir/a.md': at(1), 'dirt.md': at(3) })
    expect(s.forget('dir')).toBe(true)
    expect(Object.keys(s.toJSON())).toEqual(['dirt.md'])
    expect(s.forget('dir')).toBe(false)
  })

  it('prunes notes that are gone, and past the limit those visited longest ago', () => {
    const s = NotePlaces.from({ 'gone.md': at(1, 9), 'old.md': at(1, 1), 'new.md': at(1, 5) })
    expect(s.prune((p) => p !== 'gone.md', 1)).toBe(true)
    expect(Object.keys(s.toJSON())).toEqual(['new.md'])
    expect(s.prune(() => true, 1)).toBe(false)
    expect(MAX_PLACES).toBeGreaterThan(100)
  })
})

describe('a place asked for, in an opening', () => {
  it.each([
    [{ subpath: '#Heading' }, true],
    [{ subpath: '#^block' }, true],
    [{ line: 12 }, true],
    [{ line: 0 }, true],
    [{ scroll: 40 }, true],
    [{ match: { content: 'x', matches: [[1, 2]] } }, true],
    [{ cursor: { from: { line: 1, ch: 0 }, to: { line: 1, ch: 0 } } }, true],
    [{ focus: true }, false],
    [{ rename: 'all' }, false],
    [{ subpath: '' }, false],
    [{ line: undefined, focus: true }, false],
    [undefined, false],
    [null, false],
  ])('%j → %s', (eState, explicit) => {
    expect(isExplicitTarget(eState)).toBe(explicit)
  })
})

/** A view as the keeper sees it: a note and a scroll, moved by `apply`. */
interface FakeView {
  path: string | null
  scroll: number
  /** How many applies it takes before a scroll lands: a note still being laid out. */
  lagging: number
  applied: number
  /** A tab behind another: its scroller reports nothing worth reading. */
  hidden?: boolean
  /** The furthest it can scroll: a note shorter than the place saved for it. */
  end?: number
  /** Lines a scroll lands short by each time: a note growing above the place as it renders. */
  short?: number
  /** How many times the cursor was put back. */
  cursorSets: number
  /** What is listening for the person's own scrolling, touching or typing in it. */
  listeners: Set<() => void>
  /** Rows of the list under the note drawn so far, by key, and the one put at the top. */
  rows?: Set<string>
  aligned?: string[]
  held?: number
}

const view = (path: string | null, scroll = 0): FakeView => ({
  path,
  scroll,
  lagging: 0,
  applied: 0,
  cursorSets: 0,
  listeners: new Set(),
})

/** The person scrolls the view themselves: a wheel, a touch, a key. */
const touch = (v: FakeView, scroll: number) => {
  v.scroll = scroll
  for (const l of [...v.listeners]) l()
}

const io: PlaceIo<FakeView> = {
  path: (v) => v.path,
  place: (v): ViewPlace | null => (v.hidden ? null : { scroll: v.scroll }),
  apply(v, place, first) {
    v.applied++
    if (first) v.cursorSets++
    if (v.lagging > 0) v.lagging--
    else v.scroll = Math.min(place.scroll - (v.short ?? 0), v.end ?? Infinity)
  },
  atEnd: (v) => v.end !== undefined && v.scroll >= v.end,
  watchInput(v, onInput) {
    v.listeners.add(onInput)
    return () => v.listeners.delete(onInput)
  },
  alignAnchor(v, anchor) {
    if (!v.rows?.has(anchor.key)) return false
    ;(v.aligned ??= []).push(anchor.key)
    return true
  },
  holdAnchor(v) {
    v.held = (v.held ?? 0) + 1
    return () => {
      v.held = (v.held ?? 1) - 1
    }
  },
}

describe('the keeper', () => {
  let saved: unknown
  let enabled: boolean
  let keeper: NotePlaceKeeper<FakeView>

  const make = (stored: unknown = {}) => {
    saved = undefined
    keeper = new NotePlaceKeeper(io, {
      enabled: () => enabled,
      now: () => 1000,
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      load: () => stored,
      save: (v) => (saved = v),
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    enabled = true
    make({ 'long.md': at(80) })
  })

  it('puts a plainly opened note back at its saved place', () => {
    const v = view('long.md')
    keeper.opened(v, 'long.md', false)
    expect(keeper.isPending(v)).toBe(true)
    vi.advanceTimersByTime(RESTORE_STEP_MS * 3)
    expect(v.scroll).toBe(80)
    expect(keeper.isPending(v)).toBe(false)
  })

  it('does not restore a note opened at a place asked for', () => {
    const v = view('long.md', 30)
    keeper.opened(v, 'long.md', true)
    vi.advanceTimersByTime(RESTORE_WINDOW_MS * 2)
    expect(v.scroll).toBe(30)
    expect(v.applied).toBe(0)
  })

  it('calls the restore off when a place is asked for just after the note opened', () => {
    const v = view('long.md')
    keeper.opened(v, 'long.md', false)
    // The reader: the note opened, then scrolled to the highlight straight away.
    keeper.claim(v)
    v.scroll = 55
    vi.advanceTimersByTime(RESTORE_WINDOW_MS * 2)
    expect(v.scroll).toBe(55)
    expect(v.applied).toBe(0)
  })

  it('keeps trying while the note is laid out, and stops when it lands', () => {
    const v = view('long.md')
    v.lagging = 3
    keeper.opened(v, 'long.md', false)
    vi.advanceTimersByTime(RESTORE_STEP_MS * 10)
    expect(v.scroll).toBe(80)
    expect(v.applied).toBe(4)
    expect(keeper.isPending(v)).toBe(false)
  })

  it('gives up after a while rather than hold the note forever', () => {
    const v = view('long.md')
    v.lagging = 1e9
    keeper.opened(v, 'long.md', false)
    vi.advanceTimersByTime(RESTORE_WINDOW_MS * 3)
    expect(keeper.isPending(v)).toBe(false)
    expect(v.applied).toBeLessThanOrEqual(RESTORE_WINDOW_MS / RESTORE_STEP_MS + 1)
  })

  it('puts a tab opened behind another back once it shows, and saves nothing from it meanwhile', () => {
    const v = view('long.md')
    v.hidden = true
    keeper.opened(v, 'long.md', false)
    vi.advanceTimersByTime(RESTORE_WINDOW_MS * 4)
    expect(v.applied).toBe(0)
    expect(keeper.isPending(v)).toBe(true)
    v.hidden = false
    vi.advanceTimersByTime(HIDDEN_STEP_MS + RESTORE_STEP_MS * 3)
    expect(v.scroll).toBe(80)
    expect(keeper.isPending(v)).toBe(false)
    v.hidden = true
    keeper.sample(v)
    expect(keeper.places.get('long.md')?.scroll).toBe(80)
  })

  it('lets a hidden tab go after a long while', () => {
    const v = view('long.md')
    v.hidden = true
    keeper.opened(v, 'long.md', false)
    vi.advanceTimersByTime(HIDDEN_WAIT_MS + RESTORE_WINDOW_MS + 1000)
    expect(keeper.isPending(v)).toBe(false)
  })

  it('lands once and stays: a note that keeps growing is corrected a couple of times at most', () => {
    const v = view('long.md')
    v.short = 3
    keeper.opened(v, 'long.md', false)
    vi.advanceTimersByTime(RESTORE_WINDOW_MS * 2)
    expect(v.applied).toBeLessThanOrEqual(1 + MAX_CORRECTIONS)
    expect(v.cursorSets).toBe(1)
    expect(keeper.isPending(v)).toBe(false)
  })

  it('stops at the end of a note shorter than its saved place', () => {
    const v = view('long.md')
    v.end = 60
    keeper.opened(v, 'long.md', false)
    vi.advanceTimersByTime(RESTORE_WINDOW_MS * 2)
    expect(v.scroll).toBe(60)
    expect(v.applied).toBe(1)
    expect(keeper.isPending(v)).toBe(false)
  })

  it("never pulls back the person's own scrolling, and stops listening once done", () => {
    const v = view('long.md')
    v.short = 3
    keeper.opened(v, 'long.md', false)
    expect(v.listeners.size).toBe(1)
    vi.advanceTimersByTime(RESTORE_STEP_MS)
    expect(v.scroll).toBe(77)
    touch(v, 20)
    vi.advanceTimersByTime(RESTORE_WINDOW_MS * 2)
    expect(v.scroll).toBe(20)
    expect(v.applied).toBe(1)
    expect(keeper.isPending(v)).toBe(false)
    expect(v.listeners.size).toBe(0)
    // Where the person went is what gets saved.
    keeper.sample(v)
    expect(keeper.places.get('long.md')?.scroll).toBe(20)
  })

  it('stops listening once the place has landed', () => {
    const v = view('long.md')
    keeper.opened(v, 'long.md', false)
    vi.advanceTimersByTime(RESTORE_WINDOW_MS)
    expect(v.scroll).toBe(80)
    expect(v.listeners.size).toBe(0)
  })

  it('leaves a note with no saved place, or saved at its top, alone', () => {
    make({ 'top.md': at(0) })
    const a = view('none.md', 7)
    const b = view('top.md', 7)
    keeper.opened(a, 'none.md', false)
    keeper.opened(b, 'top.md', false)
    vi.advanceTimersByTime(RESTORE_WINDOW_MS)
    expect([a.applied, b.applied, a.scroll, b.scroll]).toEqual([0, 0, 7, 7])
    expect(a.listeners.size + b.listeners.size).toBe(0)
  })

  describe('a place in the list under the note', () => {
    const anchored = { 'group.md': { ...at(80), anchor: { key: 'task:t.md', offset: 40 } } }

    it('waits for its row to be drawn, puts it back once, holds it, then lets go', () => {
      make(anchored)
      const v = view('group.md')
      v.rows = new Set()
      keeper.opened(v, 'group.md', false)
      vi.advanceTimersByTime(RESTORE_STEP_MS * 10)
      expect(v.scroll).toBe(80)
      expect(v.aligned ?? []).toEqual([])
      expect(keeper.isPending(v)).toBe(true)
      v.rows.add('task:t.md')
      vi.advanceTimersByTime(RESTORE_STEP_MS * 2)
      expect(v.aligned).toEqual(['task:t.md'])
      expect(v.held).toBe(1)
      vi.advanceTimersByTime(ANCHOR_HOLD_MS)
      expect(v.held).toBe(0)
      expect(keeper.isPending(v)).toBe(false)
      expect(v.listeners.size).toBe(0)
    })

    it('stops holding the moment the person scrolls', () => {
      make(anchored)
      const v = view('group.md')
      v.rows = new Set(['task:t.md'])
      keeper.opened(v, 'group.md', false)
      vi.advanceTimersByTime(RESTORE_STEP_MS * 4)
      expect(v.held).toBe(1)
      touch(v, 70)
      expect(v.held).toBe(0)
      expect(keeper.isPending(v)).toBe(false)
    })

    it('gives up on a row that never comes, and leaves the line where it got to', () => {
      make(anchored)
      const v = view('group.md')
      v.rows = new Set()
      keeper.opened(v, 'group.md', false)
      vi.advanceTimersByTime(ANCHOR_WAIT_MS + RESTORE_WINDOW_MS)
      expect(keeper.isPending(v)).toBe(false)
      expect(v.scroll).toBe(80)
      expect(v.held ?? 0).toBe(0)
    })

    it('keeps the row with the place, and a place in the list is never taken for the top', () => {
      const s = NotePlaces.from({
        'a.md': { scroll: 0, at: 1, anchor: { key: 'section:tasks', offset: -12 } },
      })
      expect(s.get('a.md')?.anchor).toEqual({ key: 'section:tasks', offset: -12 })
      expect(
        s.remember('a.md', { scroll: 0, at: 2, anchor: { key: 'section:tasks', offset: -30 } })
      ).toBe(true)
      make({ 'a.md': { scroll: 0, at: 1, anchor: { key: 'section:tasks', offset: 5 } } })
      const v = view('a.md')
      v.rows = new Set(['section:tasks'])
      keeper.opened(v, 'a.md', false)
      vi.advanceTimersByTime(RESTORE_STEP_MS * 3)
      expect(v.aligned).toEqual(['section:tasks'])
    })
  })

  it('drops the restore when the view has moved on to another note', () => {
    const v = view('long.md')
    keeper.opened(v, 'long.md', false)
    v.path = 'other.md'
    vi.advanceTimersByTime(RESTORE_WINDOW_MS)
    expect(v.applied).toBe(0)
  })

  it('restores nothing, and saves nothing, while switched off', () => {
    enabled = false
    const v = view('long.md')
    keeper.opened(v, 'long.md', false)
    vi.advanceTimersByTime(RESTORE_WINDOW_MS)
    expect(v.applied).toBe(0)
    v.scroll = 5
    keeper.sample(v)
    expect(keeper.places.get('long.md')?.scroll).toBe(80)
  })

  it('does not save a view whose restore is still waiting, and saves it once it landed', () => {
    const v = view('long.md')
    keeper.opened(v, 'long.md', false)
    keeper.sample(v) // still at the top, on its way to 80
    expect(keeper.places.get('long.md')?.scroll).toBe(80)
    vi.advanceTimersByTime(RESTORE_STEP_MS * 3)
    v.scroll = 90
    keeper.sample(v)
    expect(keeper.places.get('long.md')?.scroll).toBe(90)
  })

  it('does not keep a note never moved from its top, but keeps its top once it had a place', () => {
    const fresh = view('fresh.md')
    keeper.opened(fresh, 'fresh.md', false)
    keeper.sample(fresh)
    expect(keeper.places.get('fresh.md')).toBeUndefined()
    fresh.scroll = 12
    keeper.sample(fresh)
    fresh.scroll = 0
    keeper.sample(fresh)
    expect(keeper.places.get('fresh.md')?.scroll).toBe(0)
  })

  it('writes changes after a pause, once, and flushes on demand', () => {
    const v = view('a.md')
    keeper.opened(v, 'a.md', false)
    v.scroll = 3
    keeper.sample(v)
    v.scroll = 4
    keeper.sample(v)
    expect(saved).toBeUndefined()
    vi.advanceTimersByTime(SAVE_DELAY_MS)
    expect((saved as Record<string, NotePlace>)['a.md'].scroll).toBe(4)
    saved = undefined
    keeper.flush()
    expect(saved).toBeUndefined()
    keeper.deleted('a.md')
    keeper.flush()
    expect(saved).toEqual({ 'long.md': at(80) })
  })

  it('takes the other plugin’s places without overwriting its own', () => {
    expect(keeper.adopt({ 'long.md': at(5), 'b.md': at(7) })).toBe(1)
    expect(keeper.places.get('long.md')?.scroll).toBe(80)
    expect(keeper.places.get('b.md')?.scroll).toBe(7)
  })
})

describe("the other plugin's file", () => {
  it('reads its scroll, cursor and time, and skips what is not a place', () => {
    const places = placesFromRememberCursor(
      {
        'a.md': {
          cursor: { from: { ch: 1, line: 2 }, to: { ch: 3, line: 4 } },
          scroll: 17.5,
          lastModified: 42,
        },
        'b.md': { scroll: 3 },
        'c.md': { cursor: { from: { ch: 0, line: 0 }, to: { ch: 0, line: 0 } } },
      },
      99
    )
    expect(places['a.md']).toEqual({
      scroll: 17.5,
      at: 42,
      cursor: { from: { line: 2, ch: 1 }, to: { line: 4, ch: 3 } },
    })
    expect(places['b.md']).toEqual({ scroll: 3, at: 99 })
    expect(places['c.md']).toBeUndefined()
    expect(placesFromRememberCursor('junk', 1)).toEqual({})
  })
})

describe('the hooks into Obsidian', () => {
  // Imported here: the module wires into the app's own classes.
  const load = () => import('@/notePlaces/register')

  class View extends MarkdownView {
    file: { path: string } | null = null
    states: unknown[] = []
    unloaded: string[] = []
  }

  const makeProtos = () => {
    const leafProto = {
      detached: 0,
      detach(this: { view: View }) {
        leafProto.detached++
      },
      async setViewState(this: { view: View }, vs: unknown, eState?: unknown) {
        const next = (vs as { file: string; fresh?: boolean }).file
        if ((vs as { fresh?: boolean }).fresh) this.view = new View()
        this.view.file = { path: next }
        if (eState) this.view.setEphemeralState(eState)
      },
    }
    const viewProto = {
      setEphemeralState(this: View, state: unknown) {
        this.states.push(state)
      },
      async onUnloadFile(this: View, file: { path: string }) {
        this.unloaded.push(file.path)
      },
    }
    return { leafProto, viewProto }
  }

  const fakeKeeper = () => ({
    opened: vi.fn(),
    claim: vi.fn(),
    sample: vi.fn(),
  })

  it('tells a plain opening from one at a place, and a place asked for later', async () => {
    const { hookViews } = await load()
    const { leafProto, viewProto } = makeProtos()
    const k = fakeKeeper()
    const undo = hookViews(k as never, leafProto as never, viewProto as never)
    Object.setPrototypeOf(viewProto, MarkdownView.prototype)
    Object.setPrototypeOf(View.prototype, viewProto)
    const leaf = { view: new View() }

    await leafProto.setViewState.call(leaf, { file: 'a.md' })
    expect(k.opened).toHaveBeenLastCalledWith(leaf.view, 'a.md', false)

    await leafProto.setViewState.call(leaf, { file: 'b.md' }, { subpath: '#Top' })
    expect(k.opened).toHaveBeenLastCalledWith(leaf.view, 'b.md', true)

    await leafProto.setViewState.call(leaf, { file: 'c.md' }, { focus: true })
    expect(k.opened).toHaveBeenLastCalledWith(leaf.view, 'c.md', false)

    // Same note, same view: a mode switch is no opening; a link to a heading in it is a place.
    k.opened.mockClear()
    await leafProto.setViewState.call(leaf, { file: 'c.md' })
    expect(k.opened).not.toHaveBeenCalled()
    k.claim.mockClear()
    await leafProto.setViewState.call(leaf, { file: 'c.md' }, { line: 4 })
    expect(k.opened).not.toHaveBeenCalled()
    expect(k.claim).toHaveBeenCalledWith(leaf.view)

    // A place asked for once the note is open, by a plugin say.
    k.claim.mockClear()
    leaf.view.setEphemeralState({ focus: true })
    expect(k.claim).not.toHaveBeenCalled()
    leaf.view.setEphemeralState({ line: 9 })
    expect(k.claim).toHaveBeenCalledWith(leaf.view)
    expect(leaf.view.states.at(-1)).toEqual({ line: 9 })

    // The place is saved before the view lets its note go.
    await (leaf.view as unknown as { onUnloadFile(f: unknown): Promise<void> }).onUnloadFile({
      path: 'c.md',
    })
    expect(k.sample).toHaveBeenCalledWith(leaf.view)
    expect(leaf.view.unloaded).toEqual(['c.md'])

    // A tab closing is saved while it still shows.
    k.sample.mockClear()
    leafProto.detach.call(leaf)
    expect(k.sample).toHaveBeenCalledWith(leaf.view)
    expect(leafProto.detached).toBe(1)

    undo()
    k.opened.mockClear()
    await leafProto.setViewState.call(leaf, { file: 'd.md' })
    expect(k.opened).not.toHaveBeenCalled()
  })
})
