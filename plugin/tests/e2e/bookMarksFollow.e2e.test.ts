/**
 * Highlights stay on their words when the words move under them, in the running app, on the
 * desktop in two columns.
 *
 * The engine measures a highlight once and again only when the chapter changes size by a page.
 * Words can move without that: something above them in the same column grows — a picture, a
 * font, a style arriving late — and the chapter keeps its page count. Seen in a book's notes
 * (2026-09-26): highlights one and two page margins above their words, painting note numbers and
 * the gaps between notes. Here a paragraph above a highlight is made taller by a few lines, the
 * page count checked unchanged, and every box drawn compared with where its words now are; then
 * the same after turning a page and back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildProseEpub } from '../fixtures/books/proseBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader marks follow e2e'
const BOOK = `${DIR}/prose.epub`

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const R = (view) => view.engine.renderer
  const contents = (view) => R(view).getContents()[0]
  /** Each box drawn over the page and each line of the highlight's words, in the window. */
  const boxes = (view, cfi) => {
    const c = contents(view)
    const frame = c.doc.defaultView.frameElement.getBoundingClientRect()
    const svg = c.overlayer.element.getBoundingClientRect()
    const drawn = [...c.overlayer.element.querySelectorAll('rect')]
      .map((r) => [Math.round(+r.getAttribute('x') + svg.left), Math.round(+r.getAttribute('y') + svg.top)])
    const range = view.engine.resolveNavigation(cfi).anchor(c.doc)
    const words = [...range.getClientRects()]
      .map((r) => [Math.round(r.left + frame.left), Math.round(r.top + frame.top)])
    return { drawn, words }
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

type Boxes = { drawn: number[][]; words: number[][] }

describe.skipIf(!available)('highlights follow their words', () => {
  let savedReader: unknown = null
  let size: [number, number] = [0, 0]
  let panels: [boolean, boolean] = [false, false]

  beforeAll(() => {
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    panels = evalJson<[boolean, boolean]>(
      `(() => { const w = app.workspace, was = [w.leftSplit.collapsed, w.rightSplit.collapsed]; w.leftSplit.collapse(); w.rightSplit.collapse(); return was })()`
    )
    const data = Buffer.from(buildProseEpub()).toString('base64')
    evalRaw(
      `(async () => {
        require('@electron/remote').getCurrentWindow().setContentSize(1280, 800)
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, flow: 'paginated', columns: 2 }
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
        for (const leaf of app.workspace.getLeavesOfType('markdown'))
          if (leaf.view.file?.path?.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        const places = cfg.reader?.placesPath || 'abele-book-places.json'
        if (await app.vault.adapter.exists(places)) await app.vault.adapter.remove(places)
        const w = app.workspace
        if (!${panels[0]}) w.leftSplit.expand()
        if (!${panels[1]}) w.rightSplit.expand()
        require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('moves a highlight with its words when a paragraph above grows and the page count does not', () => {
    const r = run<{
      error?: string
      columns?: number
      pagesBefore?: number
      pagesAfter?: number
      before?: Boxes
      grown?: Boxes
      turned?: Boxes
      shift?: number
    }>(`
      let leaf
      try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
      await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
      const view = await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading && leaf.view)
      if (view.model.panel) { view.model.panel = false; await wait(400) }
      await wait(800)
      await view.engine.goTo(view.model.toc[0].href); await wait(600)
      await R(view).next(); await wait(900)
      const doc = contents(view).doc
      const frame = doc.defaultView.frameElement.getBoundingClientRect()
      const page = R(view).getBoundingClientRect()
      // A paragraph that begins in the page's second column; the one before it runs on into that
      // column above it, so growing that one moves these words and adds no page.
      const startOf = (p) => {
        const r = doc.createRange()
        r.setStart(p.firstChild, 0)
        r.setEnd(p.firstChild, 1)
        const b = r.getBoundingClientRect()
        return { x: b.left + frame.left, y: b.top + frame.top }
      }
      const target = [...doc.querySelectorAll('p')].find((p) => {
        const at = startOf(p)
        return at.x >= page.left + page.width / 2 && at.x < page.right && at.y >= page.top
      })
      const above = target.previousElementSibling
      const text = target.firstChild
      const range = doc.createRange()
      range.setStart(text, 0); range.setEnd(text, Math.min(60, text.length))
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      const cfi = view.model.selection.cfi
      await view.reading.highlight('yellow')
      await until(() => contents(view).overlayer.element.querySelector('rect'), 5000)
      await wait(500)
      const before = boxes(view, cfi)
      const pagesBefore = R(view).pages
      // The paragraph above grows by about two lines; the chapter keeps its pages.
      above.style.setProperty('padding-top', '48px')
      await wait(800)
      const grown = boxes(view, cfi)
      const pagesAfter = R(view).pages
      await R(view).next(); await wait(900)
      await R(view).prev(); await wait(900)
      const turned = boxes(view, cfi)
      return {
        columns: R(view).columns, pagesBefore, pagesAfter, before, grown, turned,
        shift: grown.words[0][1] - before.words[0][1],
      }
    `)
    expect(r.error).toBeUndefined()
    expect(r.columns).toBe(2)
    // The case the engine does not see: the words moved, the page count did not.
    expect(r.pagesAfter).toBe(r.pagesBefore)
    expect(r.shift).toBeGreaterThan(20)
    for (const [name, b] of [
      ['drawn', r.before],
      ['after the paragraph above grew', r.grown],
      ['after a page turned and back', r.turned],
    ] as const) {
      expect(b?.drawn.length, `${name}: boxes drawn`).toBe(b?.words.length)
      b?.drawn.forEach((d, i) => {
        expect(Math.abs(d[0] - b.words[i][0]), `${name}: box ${i} left`).toBeLessThanOrEqual(1)
        expect(Math.abs(d[1] - b.words[i][1]), `${name}: box ${i} top`).toBeLessThanOrEqual(1)
      })
    }
  })
})
