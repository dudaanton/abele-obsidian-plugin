/**
 * A book's own stylesheets, in the running app (`src/reader/bookStyles.ts`).
 *
 * The book (`styledBook.ts`) links a stylesheet that imports another. With "Book's own styles" on,
 * its indents, alignment, table and drop cap show; its fixed text size follows the reader's; its
 * rules reaching outside the book — a picture and an import on the web — are gone, and no request
 * leaves for them. Off, the page is laid out as if the book had no stylesheet, at once. The e2e
 * fixture EPUB (`epub-test.epub`), which names a picture on the web in its stylesheet, opens with
 * its own rules and without the picture. Pictures go to `/tmp/abele-phone/styles-*.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { buildStyledEpub, OUTSIDE } from '../fixtures/books/styledBook'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader book styles e2e'
const BOOK = `${DIR}/styled.epub`
const TEST_EPUB = `${DIR}/epub-test.epub`
const SHOTS = shotDir('abele-phone')

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const R = (view) => view.engine.renderer
  const docOf = (view) => R(view).getContents()[0].doc
  const cfg = window.__abeleTest.AbeleConfig.getInstance()
  const setReader = async (patch) => { cfg.reader = { ...cfg.reader, ...patch }; await cfg.saveSettings(); await wait(700) }
  const open = async (path) => {
    for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    const view = await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading && leaf.view)
    if (view.model.panel) { view.model.panel = false; await wait(400) }
    await wait(800)
    return view
  }
  const shoot = async (name) => {
    const shot = await Promise.race([
      require('@electron/remote').getCurrentWebContents().debugger.sendCommand('Page.captureScreenshot', { format: 'png' }).catch(() => null),
      wait(8000).then(() => null),
    ])
    if (shot) {
      require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/styles-' + name + '.png', Buffer.from(shot.data, 'base64'))
    }
  }
  /** Requests the window makes to a host, while \`fn\` runs. */
  const requestsTo = async (host, fn) => {
    const seen = []
    const filter = { urls: ['*://' + host + '/*'] }
    const session = require('@electron/remote').getCurrentWebContents().session
    session.webRequest.onBeforeRequest(filter, (details, callback) => { seen.push(details.url); callback({ cancel: true }) })
    try { await fn() } finally { session.webRequest.onBeforeRequest(filter, null) }
    return seen
  }
`

// Started in the page and asked after until it is done: walking every chapter of a real book
// takes longer than one CLI call may block the test worker for.
const run = async <T>(body: string): Promise<T> =>
  JSON.parse(
    await evalLong(
      `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
      120_000
    )
  ) as T

describe.skipIf(!available)("a book's own styles", () => {
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
    const files = {
      'styled.epub': Buffer.from(buildStyledEpub()).toString('base64'),
      'epub-test.epub': readFileSync(join(__dirname, '../fixtures/books/epub-test.epub')).toString(
        'base64'
      ),
    }
    evalRaw(
      `(async () => {
        require('@electron/remote').getCurrentWindow().setContentSize(1280, 800)
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, flow: 'paginated', columns: 2, fontSize: 100, bookStyles: true }
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

  it('shows its layout, keeps the reader’s text size, and fetches nothing outside the book', async () => {
    type Look = {
      indent: string
      centre: string
      num: string
      drop: string
      big: number
      body: number
      remote: string
      marked: number
      links: number
      wrapper: string
      bodyPad: string
      quote: string
      cellFont: string
      textFont: string
    }
    const r = await run<{
      error?: string
      on?: Look
      larger?: Look
      off?: Look
      requests?: string[]
      css?: string
    }>(`
      const look = (view) => {
        const doc = docOf(view)
        const cs = (id, pseudo) => doc.defaultView.getComputedStyle(doc.getElementById(id), pseudo)
        return {
          indent: cs('indent').textIndent, centre: cs('centre').textAlign, num: cs('num').textAlign,
          drop: cs('dropcap', '::first-letter').float,
          big: parseFloat(cs('big').fontSize), body: parseFloat(cs('indent').fontSize),
          remote: cs('remote').backgroundImage,
          marked: doc.querySelectorAll('style[data-abele-book-style]').length,
          links: doc.querySelectorAll('link').length,
          wrapper: cs('wrapper').marginLeft + ' ' + cs('wrapper').paddingLeft,
          bodyPad: doc.defaultView.getComputedStyle(doc.body).paddingLeft,
          quote: cs('quote').marginLeft,
          cellFont: cs('num').fontFamily, textFont: cs('indent').fontFamily,
        }
      }
      let view, on, larger, off, css
      const requests = await requestsTo(${JSON.stringify(new URL(OUTSIDE).host)}, async () => {
        view = await open(${JSON.stringify(BOOK)})
        on = look(view)
        css = [...docOf(view).querySelectorAll('style[data-abele-book-style]')].map((s) => s.textContent).join('\\n')
        await shoot('on')
        await setReader({ fontSize: 150 })
        larger = look(view)
        await setReader({ fontSize: 100, bookStyles: false })
        off = look(view)
        await shoot('off')
        await setReader({ bookStyles: true })
      })
      return { on, larger, off, requests, css }
    `)
    expect(r.error).toBeUndefined()
    const on = r.on as Look
    expect(on.marked).toBe(1)
    expect(on.links).toBe(0)
    expect(parseFloat(on.indent)).toBeGreaterThan(30)
    expect(on.centre).toBe('center')
    expect(on.num).toBe('right')
    expect(on.drop).toBe('left')
    expect(on.remote).toBe('none')
    // The reader's page margins and font win; a quote keeps its own indent.
    expect(on.wrapper).toBe('0px 0px')
    expect(on.bodyPad).toBe('0px')
    expect(parseFloat(on.quote)).toBeGreaterThan(10)
    expect(on.cellFont).not.toMatch(/Courier|monospace/)
    expect(on.textFont).not.toMatch(/Courier|monospace/)
    // 40px in the book, made to follow the reader's size.
    expect((r.larger?.big ?? 0) / on.big).toBeCloseTo(1.5, 1)
    expect(r.css).not.toContain('outside.invalid')
    expect(r.requests).toEqual([])
    const off = r.off as Look
    expect(off.indent).toBe('0px')
    expect(off.num).not.toBe('right')
    expect(off.drop).not.toBe('left')
  })

  it("opens a real book's stylesheet with its own rules and without its picture on the web", async () => {
    const r = await run<{
      error?: string
      found?: number
      css?: string
      requests?: string[]
    }>(`
      let found = 0, css = ''
      const requests = await requestsTo('idpf.org', async () => {
        const view = await open(${JSON.stringify(TEST_EPUB)})
        for (let i = 0; i < view.engine.book.sections.length; i++) {
          await view.engine.goTo(i); await wait(400)
          const doc = docOf(view)
          const styles = [...doc.querySelectorAll('style[data-abele-book-style]')]
          if (styles.length) { found++; css += styles.map((s) => s.textContent).join('\\n') }
        }
      })
      return { found, css, requests }
    `)
    expect(r.error).toBeUndefined()
    expect(r.found).toBeGreaterThan(0)
    expect(r.css).toContain('border: 1px solid')
    expect(r.css).not.toContain('idpf.org')
    expect(r.requests).toEqual([])
  })
})
