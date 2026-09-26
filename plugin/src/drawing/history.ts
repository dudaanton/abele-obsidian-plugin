/**
 * The items of a drawing, in the order they are painted, and what can be undone.
 *
 * Every edit is a list of changes, one per item: what the item was before (nothing, for one just
 * drawn), what it is after (nothing, for one erased), and where it stood. Undo puts back the
 * befores, redo the afters, each at its old place so the order of what lies over what comes back
 * too.
 */
import type { DrawingItem } from './items'

export interface ItemChange {
  id: string
  before: DrawingItem | null
  after: DrawingItem | null
  /**
   * Where the item stood among the others when its change was made — the changes of a step being
   * made one after the other, so an item taken away after another counts its place without it.
   */
  at: number
}

export class DrawingItems {
  private list: DrawingItem[] = []
  private past: ItemChange[][] = []
  private future: ItemChange[][] = []

  constructor(private readonly limit = 300) {}

  get items(): readonly DrawingItem[] {
    return this.list
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** A drawing read in afresh: what undo held is about items that may no longer be there. */
  load(items: DrawingItem[]): void {
    this.list = [...items]
    this.past = []
    this.future = []
  }

  get(id: string): DrawingItem | undefined {
    return this.list.find((i) => i.id === id)
  }

  /** New items on top. */
  add(items: DrawingItem[]): ItemChange[] {
    return this.commit(
      items.map(
        (after, n): ItemChange => ({ id: after.id, before: null, after, at: this.list.length + n })
      )
    )
  }

  /** Items taken away. */
  remove(ids: Iterable<string>): ItemChange[] {
    const want = new Set(ids)
    const changes: ItemChange[] = []
    this.list.forEach((item, at) => {
      if (want.has(item.id))
        changes.push({ id: item.id, before: item, after: null, at: at - changes.length })
    })
    return this.commit(changes)
  }

  /** Items changed in place: each new one takes the place of the one with its id. */
  replace(items: DrawingItem[]): ItemChange[] {
    const changes: ItemChange[] = []
    // Where each item stands, found once: a thousand picked strokes moved are one pass.
    const place = new Map(this.list.map((item, at) => [item.id, at]))
    for (const after of items) {
      const at = place.get(after.id)
      if (at !== undefined) changes.push({ id: after.id, before: this.list[at], after, at })
    }
    return this.commit(changes)
  }

  /**
   * Changes made one after the other that undo takes back as one — an eraser's whole touch.
   * `record` false applies them without a step of their own.
   */
  apply(changes: ItemChange[], record = true): ItemChange[] {
    return record ? this.commit(changes) : (this.run(changes, true), changes)
  }

  /** Joins changes already applied into one step. */
  record(changes: ItemChange[]): void {
    if (!changes.length) return
    this.past.push(changes)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }

  undo(): ItemChange[] | null {
    const step = this.past.pop()
    if (!step) return null
    this.future.push(step)
    this.run(step, false)
    return step
  }

  redo(): ItemChange[] | null {
    const step = this.future.pop()
    if (!step) return null
    this.past.push(step)
    this.run(step, true)
    return step
  }

  private commit(changes: ItemChange[]): ItemChange[] {
    if (!changes.length) return changes
    this.run(changes, true)
    this.record(changes)
    return changes
  }

  /** Takes the changes forward (the afters) or back (the befores). */
  private run(changes: ItemChange[], forward: boolean): void {
    // Out first, from the back so the places of the rest hold; then in, from the front.
    const outgoing = forward ? changes.filter((c) => !c.after) : changes.filter((c) => !c.before)
    const ids = new Set(outgoing.map((c) => c.id))
    if (ids.size) this.list = this.list.filter((i) => !ids.has(i.id))
    const swaps = changes.filter((c) => c.before && c.after)
    if (swaps.length) {
      const place = new Map(this.list.map((item, at) => [item.id, at]))
      for (const c of swaps) {
        const i = place.get(c.id)
        const now = forward ? c.after : c.before
        if (i !== undefined && now) this.list[i] = now
      }
    }
    // Each `at` was where the item stood when its change was made: forward they go in the order
    // they were made, back in the reverse, so every one finds the list as it found it then.
    const incoming = forward
      ? changes.filter((c) => !c.before)
      : changes.filter((c) => !c.after).reverse()
    for (const c of incoming) {
      const item = forward ? c.after : c.before
      if (item) this.list.splice(Math.min(c.at, this.list.length), 0, item)
    }
  }
}
