/**
 * Notes written as a `span` wrapped around blocks — the note's number in a `div`, sometimes a
 * paragraph holding only a superscript, then its paragraph — in the running app, on the desktop.
 *
 * Such a span is laid out as a block, and highlights on a note's words are drawn on those words
 * and no higher: every box is where its words are, and the words are where the paragraph is, not
 * on the note's number above it (seen in a real book, 2026-09-27). The places saved still name the
 * book's own elements, so highlights made elsewhere find their words.
 *
 * A picture arriving after the chapter was laid out has the columns laid out again.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildNotesEpub } from '../fixtures/books/notesBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader note spans e2e'
const BOOK = `${DIR}/notes.epub`

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const R = (view) => view.engine.renderer
  const contents = (view) => R(view).getContents()[0]
  const open = async () => {
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
    await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
    const view = await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading && leaf.view)
    if (view.model.panel) { view.model.panel = false; await wait(400) }
    await wait(600)
    return view
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

describe.skipIf(!available)('notes wrapped in spans', () => {
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
    const data = Buffer.from(buildNotesEpub()).toString('base64')
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

  it("draws a highlight on a note's words, not on the note's number above them", () => {
    const r = run<{
      error?: string
      display?: string
      cfis?: string[]
      checks?: { id: string; boxes: number; words: number; off: string[] }[]
    }>(`
      const view = await open()
      await view.engine.goTo(1); await wait(800)
      const out = []
      const cfis = []
      for (const id of ['t9', 't10']) {
        await view.engine.goTo(view.engine.book.sections[1].id + '#' + id); await wait(700)
        const doc = contents(view).doc
        const text = doc.getElementById(id).firstChild
        const range = doc.createRange()
        range.setStart(text, 0); range.setEnd(text, Math.min(90, text.length))
        doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
        await until(() => view.model.selection, 3000)
        cfis.push(view.model.selection.cfi)
        await view.reading.highlight('yellow')
        await until(() => view.model.highlights.length === cfis.length, 5000)
      }
      await wait(800)
      for (const [i, id] of ['t9', 't10'].entries()) {
        await view.engine.goTo(view.engine.book.sections[1].id + '#' + id); await wait(800)
        const c = contents(view), doc = c.doc
        const frame = doc.defaultView.frameElement.getBoundingClientRect()
        const svg = c.overlayer.element.getBoundingClientRect()
        const p = doc.getElementById(id)
        const range = view.engine.resolveNavigation(cfis[i]).anchor(doc)
        const words = [...range.getClientRects()].filter((w) => w.width > 1)
        const drawn = [...c.overlayer.element.querySelectorAll('rect')]
          .map((b) => [+b.getAttribute('x') + svg.left, +b.getAttribute('y') + svg.top])
        const off = []
        for (const w of words) {
          // The words are where their paragraph is drawn.
          const at = doc.elementFromPoint(w.left + 3, w.top + w.height / 2)
          if (!at || !p.contains(at)) off.push('words at ' + (at ? at.localName + '.' + at.className : 'nothing'))
          // A box is drawn over them.
          const x = w.left + frame.left, y = w.top + frame.top
          if (!drawn.some((d) => Math.abs(d[0] - x) <= 1 && Math.abs(d[1] - y) <= 1))
            off.push('no box at ' + Math.round(x) + ',' + Math.round(y))
        }
        out.push({ id, boxes: drawn.length, words: words.length, off })
      }
      const display = getComputedStyle(contents(view).doc.getElementById('n9')).display
      return { display, cfis, checks: out }
    `)
    expect(r.error).toBeUndefined()
    expect(r.display).toBe('block')
    // The places name the book's own elements: the note's span and its paragraph in it.
    expect(r.cfis?.[0]).toMatch(/\/20\[n9\]\/6\[t9\],\/1:0,\/1:\d+/)
    expect(r.cfis?.[1]).toMatch(/\/22\[n10\]\/4\[t10\],\/1:0,\/1:\d+/)
    for (const c of r.checks ?? []) {
      expect(c.words, `${c.id}: lines of words`).toBeGreaterThan(0)
      expect(c.off, `${c.id}`).toEqual([])
    }
  })

  it('lays the columns out again when a picture arrives after the chapter', () => {
    const r = run<{ error?: string; widths?: string[] }>(`
      const view = await open()
      await view.engine.goTo(0); await wait(800)
      const doc = contents(view).doc
      const root = doc.documentElement
      const widths = []
      // Each change of the root's style, by the width it had before it.
      const seen = new MutationObserver((records) => {
        for (const m of records) widths.push(/column-width:\\s*([\\d.]+px)/.exec(m.oldValue || '')?.[1] || '')
      })
      seen.observe(root, { attributes: true, attributeFilter: ['style'], attributeOldValue: true })
      const img = doc.querySelector('img')
      const src = img.getAttribute('src')
      img.removeAttribute('src'); await wait(300)
      widths.length = 0
      img.setAttribute('src', src)
      await until(() => widths.length >= 2, 5000)
      seen.disconnect()
      return { widths }
    `)
    expect(r.error).toBeUndefined()
    // Nudged by a pixel and put back: the columns laid out anew.
    const px = (r.widths ?? []).map((w) => parseFloat(w))
    expect(px.length).toBeGreaterThanOrEqual(2)
    expect(px[1] - px[0]).toBe(1)
  })
})
