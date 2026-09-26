/**
 * An open book and the places another device writes into the file while it is read there
 * (`src/reader/placeFollow.ts`): followed only while the book is not being read here, said once,
 * and never written back as this device's own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Notice } from 'obsidian'
import { BookPlaces, type PlaceStorage } from '@/reader/positions'
import { PlaceFollow, READING_MS } from '@/reader/placeFollow'

const KEY = 'id:a'

/** The places file on disk, which the other device rewrites. */
function device() {
  const file = { data: null as string | null, writes: 0 }
  const storage: PlaceStorage = {
    read: async (copy) => (copy === 'backup' ? null : file.data),
    write: async (d, copy) => {
      if (copy === 'main') {
        file.data = d
        file.writes++
      }
    },
  }
  const store = new BookPlaces(storage, 100)
  // Read once already, as by the tab that opened the book.
  const loaded = store.get(KEY)
  /** The other device, having read on, and its write arriving here. */
  const elsewhere = async (cfi: string) => {
    await loaded
    await vi.advanceTimersByTimeAsync(10)
    file.data = JSON.stringify({ [KEY]: { cfi, fraction: 0.5, path: 'a.epub', at: Date.now() } })
    await store.refresh()
    await vi.advanceTimersByTimeAsync(0)
  }
  return { file, store, elsewhere }
}

/** A tab with the book open: its page, the engine's move, and the place it writes on relocate. */
function tab(store: BookPlaces) {
  let here = 'mine-1'
  const follow = new PlaceFollow(
    store,
    KEY,
    () => here,
    async (cfi) => relocate(cfi)
  )
  const go = vi.fn()
  /** What the tab does on the engine's relocate: write the place, unless it was not its own. */
  const relocate = async (cfi: string) => {
    go(cfi)
    here = cfi
    if (follow.turned(cfi)) await store.set(KEY, { cfi, fraction: 0.5, path: 'a.epub' })
  }
  return { follow, go, turn: (cfi: string) => relocate(cfi), here: () => here }
}

beforeEach(() => {
  vi.useFakeTimers()
  Notice.shown.length = 0
})
afterEach(() => vi.useRealTimers())

describe('an open book another device reads on', () => {
  it('follows it while nobody reads here, and says so once, not at every page', async () => {
    const d = device()
    const t = tab(d.store)
    await d.elsewhere('theirs-1')
    await d.elsewhere('theirs-2')
    await d.elsewhere('theirs-3')
    expect(t.here()).toBe('theirs-3')
    expect(Notice.shown.filter((n) => /another device/.test(n))).toHaveLength(1)
  })

  it('does not write the place it followed to back as its own, so nothing echoes', async () => {
    const d = device()
    tab(d.store)
    await d.elsewhere('theirs-1')
    const before = d.file.data
    await vi.advanceTimersByTimeAsync(1000)
    expect(d.file.data).toBe(before)
    expect(d.file.writes).toBe(0)
  })

  it('stays put while read here, and the next page turned here wins', async () => {
    const d = device()
    const t = tab(d.store)
    await t.turn('mine-2')
    await d.elsewhere('theirs-1')
    expect(t.here()).toBe('mine-2')
    expect(Notice.shown).toHaveLength(0)
    await t.turn('mine-3')
    expect(t.here()).toBe('mine-3')
    await vi.advanceTimersByTimeAsync(1000)
    expect(JSON.parse(d.file.data!)[KEY].cfi).toBe('mine-3')
    expect(Notice.shown).toHaveLength(0)
  })

  it('goes to the other device’s place when it comes back into view, and says so', async () => {
    const d = device()
    const t = tab(d.store)
    await t.turn('mine-2')
    await d.elsewhere('theirs-1')
    await d.elsewhere('theirs-2')
    expect(t.here()).toBe('mine-2')
    t.follow.back()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.here()).toBe('theirs-2')
    expect(Notice.shown).toHaveLength(1)
    // Came back once more with nothing new: nothing moves, nothing is said.
    t.follow.back()
    await vi.advanceTimersByTimeAsync(0)
    expect(Notice.shown).toHaveLength(1)
  })

  it('the page laid out anew where it was is no page turned: what waits still waits', async () => {
    const d = device()
    const t = tab(d.store)
    await t.turn('mine-2')
    await d.elsewhere('theirs-1')
    // Shown again: the engine says the same page once more.
    await t.turn('mine-2')
    t.follow.back()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.here()).toBe('theirs-1')
    expect(Notice.shown).toHaveLength(1)
  })

  it('left alone a while, the first page turned here goes where the other device got to', async () => {
    const d = device()
    const t = tab(d.store)
    await t.turn('mine-2')
    await d.elsewhere('theirs-1')
    await vi.advanceTimersByTimeAsync(READING_MS)
    await t.turn('mine-3')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.here()).toBe('theirs-1')
    await vi.advanceTimersByTimeAsync(1000)
    expect(JSON.parse(d.file.data!)[KEY].cfi).toBe('theirs-1')
    expect(Notice.shown).toHaveLength(1)
  })

  it('does nothing when what arrives is the page already on screen', async () => {
    const d = device()
    const t = tab(d.store)
    await d.elsewhere('mine-1')
    expect(t.go).not.toHaveBeenCalled()
    expect(Notice.shown).toHaveLength(0)
  })

  it('hears nothing once closed', async () => {
    const d = device()
    const t = tab(d.store)
    t.follow.stop()
    await d.elsewhere('theirs-1')
    expect(t.go).not.toHaveBeenCalled()
  })
})

describe('a place set again unchanged', () => {
  it('keeps its time, so it does not reach another device as newer', async () => {
    const d = device()
    await d.store.set(KEY, { cfi: 'x', fraction: 0.5, path: 'a.epub' })
    const at = (await d.store.get(KEY))!.at
    await vi.advanceTimersByTimeAsync(5000)
    const writes = d.file.writes
    await d.store.set(KEY, { cfi: 'x', fraction: 0.5, path: 'a.epub' })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await d.store.get(KEY))!.at).toBe(at)
    expect(d.file.writes).toBe(writes)
  })
})
