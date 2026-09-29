/**
 * A highlight is drawn over its own words, in the running app, on the desktop and on a real
 * iPhone: when its place leads to other words, the words it keeps are found near that place and
 * drawn there instead.
 *
 * A highlight keeps a place (a CFI, a path of element and text steps into its chapter) and its
 * words. A highlight made on one device was drawn on another over the last sentence of a
 * paragraph pages earlier than its own: the same place led the two devices to different
 * paragraphs. Its words, kept beside the place, say which is right.
 *
 * The note here is written by hand, the way such a highlight arrives from another device: its
 * place is the end of one paragraph, its words the end of a paragraph further on. The boxes drawn
 * must stand on those words, and nothing on the paragraph its place names. A highlight whose place
 * and words agree is drawn on its place as before, and one whose words are nowhere in its chapter
 * too.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { buildJustifiedEpub } from '../fixtures/books/justifiedBook'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader highlight words e2e'
const BOOK = `${DIR}/justified.epub`
const NOTE = `${DIR}/justified highlights.md`

interface Drawn {
  error?: string
  /** Each highlight's boxes, and the rects of the words it should be drawn over. */
  marks: { name: string; groups: number[][][]; words: number[][]; other: number[][] }[]
}

describe.skipIf(!available)('a highlight is drawn over its own words', () => {
  beforeAll(() => {
    const data = Buffer.from(buildJustifiedEpub()).toString('base64')
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        for (const leaf of app.workspace.getLeavesOfType('markdown'))
          if (leaf.view.file?.path?.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        const places = cfg.reader?.placesPath || 'abele-book-places.json'
        if (await app.vault.adapter.exists(places)) await app.vault.adapter.remove(places)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('draws a highlight whose place leads elsewhere on its words, and one that agrees on its place', async () => {
    const out = await evalLong(
      `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const until = async (fn, ms = 15000) => { const d = Date.now() + ms; while (Date.now() < d) { try { const v = await fn(); if (v) return v } catch {} await wait(50) } return null }
        try {
          const open = async () => {
            let leaf; try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
            await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
            for (const other of app.workspace.getLeavesOfType('abele-book')) if (other !== leaf) other.detach()
            const view = await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading && leaf.view)
            return { leaf, view }
          }
          let { leaf, view } = await open()
          const engine = view.engine
          await engine.goTo(0)
          const doc0 = await until(() => engine.renderer.getContents().find((c) => c.index === 0)?.doc)
          /** The last words of a paragraph, as a range. */
          const tail = (doc, id, words) => {
            const p = doc.getElementById(id)
            const text = [...p.childNodes].filter((n) => n.nodeType === 3).pop()
            const parts = text.data.split(' ')
            const start = text.data.length - parts.slice(-words).join(' ').length
            const r = doc.createRange(); r.setStart(text, start); r.setEnd(text, text.data.length)
            return r
          }
          const link = (cfi) => cfi.replace(/^epubcfi\\(/, '').replace(/\\)$/, '').replace(/\\[/g, '%5B').replace(/\\]/g, '%5D')
          // Its place the end of the first paragraph, its words the end of the fifth.
          const moved = { place: engine.getCFI(0, tail(doc0, 'p1-0-0', 5)), words: String(tail(doc0, 'p1-0-4', 5)) }
          // Place and words of the third paragraph's end, agreeing.
          const kept = { place: engine.getCFI(0, tail(doc0, 'p1-0-2', 4)), words: String(tail(doc0, 'p1-0-2', 4)) }
          // Words that are nowhere in the chapter: drawn on its place, the second paragraph's end.
          const lost = { place: engine.getCFI(0, tail(doc0, 'p1-0-1', 3)), words: 'слова которых нет в книге' }
          leaf.detach()
          const entry = (color, h) => '> [!quote|' + color + '] [[justified.epub#cfi=' + link(h.place) + '|Глава 1]]\\n> ' + h.words + '\\n'
          const note = '---\\ntype: book-highlights\\nfile: "[[justified.epub]]"\\n---\\n\\n' +
            [entry('yellow', moved), entry('green', kept), entry('blue', lost)].join('\\n')
          const old = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
          if (old) await app.vault.modify(old, note)
          else await app.vault.create(${JSON.stringify(NOTE)}, note)
          ;({ leaf, view } = await open())
          await until(() => view.model.highlights.length === 3, 10000)
          const marks = []
          for (const [name, h, want, other] of [
            ['moved', moved, 'p1-0-4', 'p1-0-0'],
            ['kept', kept, 'p1-0-2', null],
            ['lost', lost, 'p1-0-1', null],
          ]) {
            await view.engine.goTo(h.place)
            await wait(900)
            const c = view.engine.renderer.getContents().find((c) => c.index === 0)
            const frame = c.doc.defaultView.frameElement.getBoundingClientRect()
            const svg = c.overlayer.element.getBoundingClientRect()
            // Every highlight's boxes: a group each in the overlayer.
            const groups = [...c.overlayer.element.children].map((g) =>
              [...g.querySelectorAll('rect')].map((r) => [Math.round(+r.getAttribute('x') + svg.left), Math.round(+r.getAttribute('y') + svg.top)]))
            const at = (range) => [...range.getClientRects()].filter((r) => r.width > 1)
              .map((r) => [Math.round(r.left + frame.left), Math.round(r.top + frame.top)])
            const words = name === 'lost' ? at(tail(c.doc, want, 3)) : at(tail(c.doc, want, name === 'kept' ? 4 : 5))
            marks.push({ name, groups, words, other: other ? at(tail(c.doc, other, 5)) : [] })
          }
          leaf.detach()
          return JSON.stringify({ marks })
        } catch (e) { return JSON.stringify({ error: String((e && e.stack) || e) }) }
      })()`,
      180_000
    )
    const r = JSON.parse(out) as Drawn
    expect(r.error).toBeUndefined()
    const same = (a: number[][], b: number[][]) =>
      a.length === b.length &&
      a.every((p, i) => Math.abs(p[0] - b[i][0]) <= 1 && Math.abs(p[1] - b[i][1]) <= 1)
    for (const m of r.marks) {
      expect(m.words.length, `${m.name}: its words on the page`).toBeGreaterThan(0)
      expect(
        m.groups.some((g) => same(g, m.words)),
        `${m.name}: drawn over its words ${JSON.stringify(m.words)}, boxes ${JSON.stringify(m.groups)}`
      ).toBe(true)
      if (m.other.length)
        expect(
          m.groups.some((g) => same(g, m.other)),
          `${m.name}: drawn over the words its place names`
        ).toBe(false)
    }
  }, 240_000)
})
