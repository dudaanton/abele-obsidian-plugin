/**
 * Points and words of a book's page, for keeping a selection to its pages: which of two points
 * comes first, and a range's words one by one.
 */
export type Point = [Node, number]

export const before = (a: Point, b: Point, doc: Document): boolean => {
  const r = doc.createRange()
  r.setStart(a[0], a[1])
  return r.comparePoint(b[0], b[1]) > 0
}

/** Every word of a range, each as a range of its own, in order. */
export function wordsIn(range: Range): Range[] {
  const doc = range.startContainer.ownerDocument
  if (!doc) return []
  const root = range.commonAncestorContainer
  const walker = doc.createTreeWalker(root.nodeType === 3 ? root.parentNode : root, 4)
  const out: Range[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue
    const t = n as Text
    const from = t === range.startContainer ? range.startOffset : 0
    const to = t === range.endContainer ? range.endOffset : t.length
    for (const m of (t.nodeValue ?? '').slice(from, to).matchAll(/\S+/g)) {
      const w = doc.createRange()
      w.setStart(t, from + (m.index ?? 0))
      w.setEnd(t, from + (m.index ?? 0) + m[0].length)
      out.push(w)
    }
  }
  return out
}

/**
 * The first word `shown` past a point (or, `-1`, the last one before it), walking the chapter's
 * text from there. Found by where the words are, not by the engine's account of the page, which
 * can take in a paragraph of the page before.
 */
export function wordFrom(
  doc: Document,
  from: Point,
  dir: 1 | -1,
  shown: (w: Range) => boolean
): Range | null {
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, 4)
  const texts: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text)
  const probe = doc.createRange()
  const words = (t: Text) =>
    Array.from((t.nodeValue ?? '').matchAll(/\S+/g)).map((m) => {
      const w = doc.createRange()
      w.setStart(t, m.index ?? 0)
      w.setEnd(t, (m.index ?? 0) + m[0].length)
      return w
    })
  const order = dir > 0 ? texts : [...texts].reverse()
  let seen = 0
  for (const t of order) {
    probe.selectNodeContents(t)
    // Text wholly before the point (after it, going back) is passed over at once.
    if (
      dir > 0 ? probe.comparePoint(from[0], from[1]) > 0 : probe.comparePoint(from[0], from[1]) < 0
    )
      continue
    const list = dir > 0 ? words(t) : words(t).reverse()
    for (const w of list) {
      const past =
        dir > 0
          ? before(from, [w.endContainer, w.endOffset], doc)
          : before([w.startContainer, w.startOffset], from, doc)
      if (!past) continue
      if (shown(w)) return w
      if (++seen > 4000) return null
    }
  }
  return null
}

/** Whether a word stands wholly inside the page box on screen. */
export function wordShown(w: Range, doc: Document, stage: DOMRect | null): boolean {
  if (!stage) return true
  const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
  // Wholly inside: the line ends of the pages either side reach into the page's margins.
  const r = w.getClientRects()[0] ?? w.getBoundingClientRect()
  const left = r.left + (frame?.left ?? 0)
  const top = r.top + (frame?.top ?? 0)
  return (
    left >= stage.left - 1 &&
    left + r.width <= stage.right + 1 &&
    top >= stage.top - 1 &&
    top + r.height <= stage.bottom + 1
  )
}

/** The page on screen as the stretch of the chapter from its first shown word to its last. */
export function pageSpan(
  visible: Range | null | undefined,
  doc: Document,
  stage: DOMRect | null
): { start: Point; end: Point } | null {
  if (!visible || visible.startContainer.ownerDocument !== doc) return null
  const words = wordsIn(visible)
  const inside = words.filter((w) => wordShown(w, doc, stage))
  const on = inside.length ? inside : words
  if (!on.length) return null
  const first = on[0]
  const last = on[on.length - 1]
  return {
    start: [first.startContainer, first.startOffset],
    end: [last.endContainer, last.endOffset],
  }
}
