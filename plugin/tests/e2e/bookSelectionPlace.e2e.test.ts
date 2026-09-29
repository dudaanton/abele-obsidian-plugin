/**
 * A word selected in a book is selected where it is drawn, in the running app: a justified book
 * set in a monospace font, on the desktop and on a real iPhone.
 *
 * iOS WebKit (iOS 26) draws a justified line in a monospace font stretched across the column,
 * and hit-tests it that way too, but on the paragraph's first layout it answers where the words
 * are — `Range.getClientRects`, the selection it paints, the highlights measured from it — as if
 * the line were not stretched. A word long-pressed was selected, with its selection painted over
 * the words to its left; every highlight sat a few letters off. Changing any font property of the
 * text puts it right, which is what switching the reader's font did.
 *
 * So for every word on the page the point in the middle of its measured box must hit that word
 * — after the page has settled, and again after the page's style changed — and on the phone a
 * real long press in the middle of a word must select that word, its selection box where the
 * word's box is. The picture of it goes to `/tmp/abele-phone/selection-place-held.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { longPress, screenshot } from './helpers/phone'
import { buildLatvianEpub } from '../fixtures/books/latvianBook'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader selection place e2e'
const BOOK = `${DIR}/lv.epub`
const SHOTS = shotDir('abele-phone')

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const cfg = window.__abeleTest.AbeleConfig.getInstance()
  const setReader = async (patch) => { cfg.reader = { ...cfg.reader, ...patch }; await cfg.saveSettings() }
  const view = () => window.__abeleSelectionPlace?.view
  const contents = () => view().engine.renderer.getContents()[0]
  const openBook = async () => {
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
    await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
    const v = await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading && leaf.view)
    if (v.model.panel) { v.model.panel = false; await wait(400) }
    // Opened beside any book already open, and those closed after: with them closed first, the
    // phone's new tab twice never finished opening the book.
    for (const other of app.workspace.getLeavesOfType('abele-book')) if (other !== leaf) other.detach()
    window.__abeleSelectionPlace = leaf
    return v
  }
  /** Every whole word on the page shown, with its measured box in the page's coordinates. */
  const wordsShown = () => {
    const doc = contents().doc
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const page = view().engine.renderer.getBoundingClientRect()
    const out = []
    for (const p of doc.querySelectorAll('p')) {
      const text = p.firstChild
      if (!text || text.nodeType !== 3) continue
      const re = /\\S+/g
      let m
      while ((m = re.exec(text.data))) {
        const range = doc.createRange()
        range.setStart(text, m.index); range.setEnd(text, m.index + m[0].length)
        const rects = [...range.getClientRects()]
        if (rects.length !== 1) continue
        const r = rects[0]
        const x = r.left + frame.left, y = r.top + frame.top
        if (x < page.left || x + r.width > page.right || y < page.top || y + r.height > page.bottom) continue
        out.push({ word: m[0], text, start: m.index, end: m.index + m[0].length, r, x, y })
      }
    }
    return out
  }
  /** The words whose measured box, hit in its middle, answers with another place in the text. */
  const misplaced = () => {
    const doc = contents().doc
    const words = wordsShown()
    const wrong = []
    for (const w of words) {
      const hit = doc.caretRangeFromPoint(w.r.left + w.r.width / 2, w.r.top + w.r.height / 2)
      const ok = hit && hit.startContainer === w.text && hit.startOffset >= w.start && hit.startOffset <= w.end
      if (!ok) {
        const t = hit?.startContainer?.data ?? ''
        const at = hit?.startOffset ?? 0
        wrong.push(w.word + ' -> ' + t.slice(Math.max(0, at - 6), at) + '|' + t.slice(at, at + 6))
      }
    }
    return { words: words.length, wrong }
  }
`

const run = async <T>(body: string): Promise<T> => {
  const out = await evalLong(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return JSON.stringify({ error: String((e && e.stack) || e) }) }
    })()`,
    120_000
  )
  try {
    return JSON.parse(out) as T
  } catch {
    throw new Error(`Not JSON from the app: ${out.slice(0, 400)}`)
  }
}

interface Placed {
  error?: string
  words: number
  wrong: string[]
}

describe.skipIf(!available)('a word is selected where it is drawn', () => {
  let savedReader: unknown = null

  beforeAll(() => {
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    const data = Buffer.from(buildLatvianEpub()).toString('base64')
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, flow: 'paginated', columns: 1, font: 'book', bookStyles: true, fontSize: 100, lineHeight: 1.5 }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        delete window.__abeleSelectionPlace
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        const places = cfg.reader?.placesPath || 'abele-book-places.json'
        if (await app.vault.adapter.exists(places)) await app.vault.adapter.remove(places)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('measures every word where a touch finds it, once the page has settled', async () => {
    const r = await run<Placed>(`
      await openBook()
      await wait(2500)
      return JSON.stringify(misplaced())
    `)
    expect(r.error).toBeUndefined()
    expect(r.words, 'words on the page').toBeGreaterThan(40)
    expect(r.wrong, 'words measured away from where they are hit').toEqual([])
  }, 120_000)

  it('still does after the page style changed', async () => {
    const r = await run<Placed>(`
      if (!view()) await openBook()
      await setReader({ lineHeight: 1.6 })
      await wait(2000)
      await setReader({ lineHeight: 1.5 })
      await wait(2000)
      return JSON.stringify(misplaced())
    `)
    expect(r.error).toBeUndefined()
    expect(r.words, 'words on the page').toBeGreaterThan(40)
    expect(r.wrong, 'words measured away from where they are hit').toEqual([])
  }, 120_000)

  it('selects the word a finger holds, with its selection over that word (phone)', async () => {
    if (!onPhone()) return
    const pick = await run<{ error?: string; word?: string; x?: number; y?: number }>(`
      if (!view()) { await openBook(); await wait(2500) }
      contents().doc.getSelection().removeAllRanges()
      // A word whose measured middle a touch finds inside another word, if the page has one:
      // there a finger held on the measure selects the wrong word. Otherwise the word before the
      // last on a line of few words, the line stretched most and the word furthest along it.
      const doc = contents().doc
      const words = wordsShown()
      const inOther = words.find((w) => {
        const hit = doc.caretRangeFromPoint(w.r.left + w.r.width / 2, w.r.top + w.r.height / 2)
        if (!hit || hit.startContainer.nodeType !== 3) return false
        const t = hit.startContainer.data, at = hit.startOffset
        const inside = at > 0 && at < t.length && /\\S/.test(t[at - 1]) && /\\S/.test(t[at])
        return inside && !(hit.startContainer === w.text && at >= w.start && at <= w.end)
      })
      const lines = []
      for (const w of words) {
        const line = lines.find((l) => Math.abs(l[0].y - w.y) < 2)
        if (line) line.push(w)
        else lines.push([w])
      }
      const line = lines.filter((l) => l.length >= 4).sort((a, b) => a.length - b.length)[0]
      const w = inOther ?? line?.[line.length - 2]
      if (!w) return JSON.stringify({ error: 'no word to hold' })
      return JSON.stringify({ word: w.word, x: Math.round(w.x + w.r.width / 2), y: Math.round(w.y + w.r.height / 2) })
    `)
    expect(pick.error).toBeUndefined()
    longPress(pick.x ?? 0, pick.y ?? 0)
    screenshot(`${SHOTS}/selection-place-held.png`)
    const r = await run<{ error?: string; selected?: string; dx?: number }>(`
      const sel = contents().doc.getSelection()
      await until(() => sel.rangeCount && String(sel).trim(), 5000)
      const words = wordsShown()
      const w = words.find((o) => Math.abs(o.x + o.r.width / 2 - ${pick.x}) < 1.5 && Math.abs(o.y + o.r.height / 2 - ${pick.y}) < 1.5)
      const box = sel.rangeCount ? sel.getRangeAt(0).getClientRects()[0] : null
      const out = { selected: String(sel).trim(), dx: box && w ? Math.round(Math.abs(box.left - w.r.left)) : -1 }
      sel.removeAllRanges()
      return JSON.stringify(out)
    `)
    expect(r.error).toBeUndefined()
    expect(r.selected, 'the word held').toBe(pick.word)
    expect(r.dx, 'the selection box starts where the word does').toBeLessThanOrEqual(1)
  }, 120_000)
})
