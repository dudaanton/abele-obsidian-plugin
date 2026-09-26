/**
 * A book's tab left for another and come back to, in the running app, on the desktop in two
 * columns: the app keeps answering, the page is the one left, and nothing is written meanwhile.
 *
 * A hidden tab has no size. The engine used to lay the chapter out at none — columns of no
 * height, a column per line — and, shown again, the app stood still while that layout was made and
 * thrown away: most of a second for this book's chapter, seconds for a long real one, and the app
 * frozen for good on a reader's own book. The layout of the hidden page and the longest stall on
 * the way back are measured; a PDF is taken the same way.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildProseEpub } from '../fixtures/books/proseBook'
import { buildLongPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader tab return e2e'
const BOOK = `${DIR}/prose.epub`
const PDF = `${DIR}/long.pdf`

/** Longer than any stall of a tab shown again once the page is not laid out while hidden. */
const STALL_MS = 300

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const placesFile = window.__abeleTest.AbeleConfig.getInstance().reader?.placesPath || 'abele-book-places.json'
  const placesNow = async () => (await app.vault.adapter.exists(placesFile)) ? app.vault.adapter.read(placesFile) : ''
  const open = async (path) => {
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading)
    await wait(800)
    return leaf
  }
  /** Another tab in front for a while, then this one again: what it cost and what it left. */
  const awayAndBack = async (leaf, hidden) => {
    const other = app.workspace.getLeaf('tab')
    await other.setViewState({ type: 'empty', active: true })
    app.workspace.setActiveLeaf(other, { focus: true })
    // The place of the last page turn is written by now.
    await wait(2500)
    const places = await placesNow()
    const whileHidden = hidden()
    const stalls = []
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) stalls.push(Math.round(e.duration)) })
    po.observe({ type: 'longtask', buffered: false })
    const t0 = performance.now()
    app.workspace.setActiveLeaf(leaf, { focus: true })
    // The app answers: a timer set now fires at once, not after a layout.
    await wait(0)
    const answered = Math.round(performance.now() - t0)
    await wait(2500)
    po.disconnect()
    other.detach()
    return { whileHidden, stalls, answered, placesKept: (await placesNow()) === places }
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

interface Returned {
  error?: string
  whileHidden?: unknown
  stalls: number[]
  answered: number
  placesKept: boolean
  before?: string
  after?: string
  columns?: number
}

describe.skipIf(!available)('a book’s tab come back to', () => {
  let savedReader: unknown = null
  let size: [number, number] = [0, 0]

  beforeAll(() => {
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    const files = {
      'prose.epub': Buffer.from(buildProseEpub()).toString('base64'),
      'long.pdf': Buffer.from(buildLongPdf(12)).toString('base64'),
    }
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        // Two columns, as the book was read in when it froze.
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, flow: 'paginated', columns: 2, maxWidth: 720, font: 'theme', lineHeight: 1.5, fontSize: 100, margin: 'normal' }
        await cfg.saveSettings()
        require('@electron/remote').getCurrentWindow().setContentSize(1400, 1000)
        app.workspace.leftSplit.collapse()
        app.workspace.rightSplit.collapse()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
        require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})
        app.workspace.leftSplit.expand()
        app.workspace.rightSplit.expand()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        const places = cfg.reader?.placesPath || 'abele-book-places.json'
        if (await app.vault.adapter.exists(places)) await app.vault.adapter.remove(places)
        return 'ok'
      })()`,
      60_000
    )
  }, 60_000)

  it('a book in two columns: no stall, the page left, nothing written while hidden', () => {
    const r = run<Returned>(`
      const leaf = await open(${JSON.stringify(BOOK)})
      const view = leaf.view
      await view.engine.goTo(view.model.toc[1].href); await wait(600)
      await view.engine.next(); await wait(400)
      await view.engine.next(); await wait(800)
      const before = view.engine.lastLocation.cfi
      const doc = view.engine.renderer.getContents()[0].doc
      const out = await awayAndBack(leaf, () => ({ height: doc.documentElement.style.height }))
      return { ...out, before, after: view.engine.lastLocation.cfi, columns: view.engine.renderer.columns }
    `)
    expect(r.error).toBeUndefined()
    expect(r.columns).toBe(2)
    // Not laid out at no height while hidden.
    expect(r.whileHidden).not.toEqual({ height: '0px' })
    expect(Math.max(0, ...r.stalls)).toBeLessThan(STALL_MS)
    expect(r.answered).toBeLessThan(STALL_MS)
    expect(r.after).toBe(r.before)
    expect(r.placesKept).toBe(true)
  })

  it('a PDF: no stall, the page left, nothing written while hidden', () => {
    const r = run<Returned>(`
      const leaf = await open(${JSON.stringify(PDF)})
      const view = leaf.view
      await view.engine.goTo(6); await wait(1500)
      const before = view.model.chapter
      const out = await awayAndBack(leaf, () => null)
      return { ...out, before, after: view.model.chapter }
    `)
    expect(r.error).toBeUndefined()
    expect(Math.max(0, ...r.stalls)).toBeLessThan(STALL_MS)
    expect(r.answered).toBeLessThan(STALL_MS)
    expect(r.after).toBe(r.before)
    expect(r.placesKept).toBe(true)
  })
})
