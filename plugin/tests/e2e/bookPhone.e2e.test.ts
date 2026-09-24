/**
 * A book on a phone: `app.emulateMobile(true)` in a 390×844 window, a plain book, the author's
 * test book and one with contents and notes opened in turn. Each is asked whether the reader
 * reaches past the screen or under Obsidian's floating header and bar, how far below the header
 * the text starts, whether the page shows text at all, and whether a tap on the right edge and a
 * swipe to the left each turn the page. The contents drawer and the text and layout dialog are
 * opened over the last one. A picture of each goes to `/tmp/abele-phone/book-*.png` — look at
 * them.
 *
 * What cannot be checked here: WebKit (the iPhone's engine), the system's long-press text
 * selection, and a real finger's swipe. Those are for the phone itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildPlainEpub } from '../fixtures/books/maliciousBook'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'

const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-phone'
const DIR = 'Abele reader phone e2e'
const available = isObsidianRunning() && hasTestApi()

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

const reload = async (how: string): Promise<void> => {
  evalRaw(`(() => { setTimeout(() => { ${how} }, 50); return 'ok' })()`, 30_000)
  await pause(4000)
  const deadline = Date.now() + 60_000
  while (!hasTestApi() && Date.now() < deadline) await pause(1000)
}

interface Screen {
  error?: string
  phone?: boolean
  over?: number
  underBar?: number
  underHeader?: number
  topGap?: number
  pageFits?: boolean
  text?: number
  swiped?: boolean
  sandbox?: string | null
  turned?: boolean
  shot?: string
}

const measure = (name: string) =>
  evalAsync<Screen>(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const until = async (fn, ms = 15000) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
      return null
    }
    const report = { phone: document.body.classList.contains('is-phone') }
    try {
      const leaf = app.workspace.getLeaf(false)
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)} + '/' + ${JSON.stringify(name)} + (${JSON.stringify(name)}.endsWith('-pdf') ? '.pdf' : '.epub'))
      // A PDF opens in the reader the way its menu item opens it.
      await leaf.setViewState({ type: 'abele-book', state: { file: file.path }, active: true })
      await app.workspace.revealLeaf(leaf)
      const view = leaf.view
      if (!await until(() => view.engine?.lastLocation)) return { ...report, error: 'the book never showed' }
      await wait(1000)
      const engine = view.engine
      const r = engine.getBoundingClientRect()
      const whole = view.contentEl.querySelector('.abele-book-reader').getBoundingClientRect()
      report.over = Math.max(0, Math.round(Math.max(r.right, whole.right) - window.innerWidth))
      // The reader keeps clear of Obsidian's floating header and navigation bar.
      const bar = document.querySelector('.mobile-navbar')?.getBoundingClientRect()
      report.underBar = bar && bar.height ? Math.max(0, Math.round(whole.bottom - bar.top)) : 0
      const header = leaf.view.containerEl.querySelector('.view-header')?.getBoundingClientRect()
      report.underHeader = header ? Math.max(0, Math.round(header.bottom - whole.top)) : 0
      const page = engine.renderer.getContents()[0]
      // How far below the header the first line of text starts.
      // A PDF page's text layer is drawn a moment after its frame loads.
      await until(() => (page.doc.body?.innerText ?? '').trim().length > 20, 8000)
      const walker = page.doc.createTreeWalker(page.doc.body, NodeFilter.SHOW_TEXT)
      let first = null
      while (!first && walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue
        const range = page.doc.createRange()
        range.selectNodeContents(walker.currentNode)
        if (range.getClientRects().length) first = range
      }
      const frameBox = page.doc.defaultView.frameElement.getBoundingClientRect()
      const frameTop = frameBox.top
      // A PDF page is a picture of a fixed shape, fitted whole and centred: it has to fit, and
      // where its own text starts inside it is the PDF's business.
      if (${JSON.stringify(name)}.endsWith('-pdf'))
        report.pageFits = frameBox.top >= r.top - 1 && frameBox.bottom <= r.bottom + 1 &&
          frameBox.left >= r.left - 1 && frameBox.right <= r.right + 1 && frameBox.height > 200
      else if (header && first) report.topGap = Math.round(first.getBoundingClientRect().top + frameTop - header.bottom)
      report.text = (page.doc.body?.innerText ?? '').trim().length
      report.sandbox = page.doc.defaultView.frameElement?.getAttribute('sandbox') ?? null

      require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      const shot = ${JSON.stringify(SHOTS)} + '/book-' + ${JSON.stringify(name)} + '.png'
      for (let attempt = 0; attempt < 3 && !report.shot?.endsWith('.png'); attempt++) {
        try {
          const capture = require('@electron/remote').getCurrentWebContents().capturePage()
          const img = await Promise.race([capture, wait(8000).then(() => null)])
          if (img) { require('fs').writeFileSync(shot, img.toPNG()); report.shot = shot }
        } catch (e) { report.shot = 'no picture: ' + String((e && e.message) || e); await wait(500) }
      }

      // A tap near the right edge of the page turns it.
      const before = engine.lastLocation.fraction
      const frame = page.doc.defaultView.frameElement.getBoundingClientRect()
      const x = r.right - 10 - frame.left
      const y = r.top + r.height / 2 - frame.top
      page.doc.elementFromPoint(Math.max(0, x), y)?.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, view: page.doc.defaultView, clientX: x, clientY: y }))
      report.turned = !!await until(() => engine.lastLocation.fraction > before, 5000)

      // A finger swiped from right to left turns the page too.
      await wait(600)
      const swipeFrom = engine.lastLocation.fraction
      const doc = engine.renderer.getContents()[0].doc
      const target = doc.body
      const touch = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: 300, screenX: x, screenY: 300 })
      const fire = (type, x) => target.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [touch(x)],
        changedTouches: [touch(x)] }))
      fire('touchstart', 300)
      for (let x = 280; x >= 80; x -= 40) { await wait(16); fire('touchmove', x) }
      fire('touchend', 80)
      report.swiped = !!await until(() => engine.lastLocation.fraction > swipeFrom, 5000)
    } catch (e) {
      report.error = String((e && e.stack) || e)
    }
    return report
  })()`)

describe.skipIf(!available)('a book on a phone', () => {
  let size: [number, number] = [0, 0]
  const screens: Record<string, Screen> = {}
  let overlays: {
    drawer?: { left: number; right: number; rows: number } | null
    afterPick?: { panel: boolean; chapter: string }
    dialog?: { left: number; right: number; width: number } | null
    search?: { hits: number; over: number }
    bar?: { over: number; height: number } | null
  } = {}

  beforeAll(async () => {
    const books = {
      plain: Buffer.from(buildPlainEpub(6)).toString('base64'),
      rich: Buffer.from(buildRichEpub()).toString('base64'),
      'plain-pdf': Buffer.from(buildPlainPdf()).toString('base64'),
      'epub-test': readFileSync(join(__dirname, '../fixtures/books/epub-test.epub')).toString(
        'base64'
      ),
    }
    evalRaw(
      `(async () => {
        if (!app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(books)})) {
          const path = ${JSON.stringify(DIR)} + '/' + name + (name.endsWith('-pdf') ? '.pdf' : '.epub')
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          const old = app.vault.getAbstractFileByPath(path)
          if (old) await app.vault.modifyBinary(old, bytes.buffer)
          else await app.vault.createBinary(path, bytes.buffer)
        }
        return 'ok'
      })()`,
      60_000
    )
    size = windowSize()
    await reload('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    await reload('window.location.reload()')
    screens.plain = measure('plain')
    screens['epub-test'] = measure('epub-test')
    screens['plain-pdf'] = measure('plain-pdf')
    screens.rich = measure('rich')
    overlays = evalAsync(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const shoot = async (name) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
            if (img) { require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/book-' + name + '.png', img.toPNG()); return }
          } catch { await wait(500) }
        }
      }
      const view = app.workspace.getLeavesOfType('abele-book')[0].view
      const report = {}
      view.model.panel = true
      await wait(800)
      const panel = view.contentEl.querySelector('.abele-book-reader__panel')?.getBoundingClientRect()
      report.drawer = panel ? { left: Math.round(panel.left), right: Math.round(panel.right), rows: view.contentEl.querySelectorAll('.abele-book-contents .tree-item-self').length } : null
      await shoot('rich-contents')
      // Picking a chapter in the drawer closes it and goes there.
      ;[...view.contentEl.querySelectorAll('.abele-book-contents .tree-item-self')].find((row) => row.textContent.trim() === 'Chapter 2')?.click()
      await wait(1500)
      report.afterPick = { panel: view.model.panel, chapter: view.model.chapter }
      view.model.settingsOpen = true
      await wait(900)
      const dialog = document.querySelector('.modal-container .modal')?.getBoundingClientRect()
      report.dialog = dialog ? { left: Math.round(dialog.left), right: Math.round(dialog.right), width: window.innerWidth } : null
      await shoot('rich-settings')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await wait(400)

      // The search in the drawer, with what it found.
      view.model.panelTab = 'search'
      view.model.panel = true
      await wait(400)
      await view.reading.search('plain text')
      await wait(400)
      const edge = (sel) => {
        let over = 0
        for (const el of view.contentEl.querySelectorAll(sel + ', ' + sel + ' *')) {
          const r = el.getBoundingClientRect()
          if (r.width) over = Math.max(over, Math.round(r.right - window.innerWidth))
        }
        return over
      }
      report.search = { hits: view.contentEl.querySelectorAll('.abele-book-search__hit').length, over: edge('.abele-book-reader__panel') }
      await shoot('rich-search')
      view.model.panel = false
      view.reading.stopSearch()
      await wait(300)

      // Words selected: the bar of what can be done to them fits the screen, on one or two rows.
      const doc = view.engine.renderer.getContents()[0].doc
      const p = doc.querySelector('p')
      const range = doc.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 5)
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      for (let i = 0; i < 30 && !view.model.selection; i++) await wait(100)
      await wait(300)
      const bar = view.contentEl.querySelector('.abele-book-selection')?.getBoundingClientRect()
      report.bar = bar ? { over: edge('.abele-book-selection'), height: Math.round(bar.height) } : null
      await shoot('rich-selection')
      view.reading.clearSelection()
      return report
    })()`)
    console.info(`\n  ${JSON.stringify(overlays)}\n`)
    console.info(`\n  ${JSON.stringify(screens)}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
    if (size[0]) await setWindowSize(size[0], size[1])
    await reload('app.emulateMobile(false)')
  }, 180_000)

  it.each(['plain', 'epub-test', 'plain-pdf', 'rich'])(
    '%s: shown in the phone layout, inside the screen',
    (name) => {
      expect(screens[name]?.error).toBeUndefined()
      expect(screens[name]?.phone).toBe(true)
      expect(screens[name]?.over).toBe(0)
      expect(screens[name]?.underBar).toBe(0)
      expect(screens[name]?.underHeader).toBe(0)
      expect(screens[name]?.text).toBeGreaterThan(20)
      // The text starts close under the header, not a thumb's width below it; a PDF page fits.
      if (name.endsWith('-pdf')) expect(screens[name]?.pageFits).toBe(true)
      else expect(screens[name]?.topGap ?? 999).toBeLessThanOrEqual(48)
    }
  )

  it.each(['plain', 'plain-pdf'])(
    '%s turns its page on a tap at the right edge, and on a swipe',
    (name) => {
      expect(screens[name]?.turned).toBe(true)
      expect(screens[name]?.swiped).toBe(true)
    }
  )

  it('the contents open as a drawer over the page, and close when a chapter is picked', () => {
    expect(overlays.drawer?.left).toBe(0)
    expect(overlays.drawer!.right).toBeLessThan(PHONE.width)
    expect(overlays.drawer!.rows).toBeGreaterThanOrEqual(4)
    expect(overlays.afterPick?.panel).toBe(false)
    expect(overlays.afterPick?.chapter).toBe('Chapter 2')
  })

  it('the text and layout dialog fits the screen', () => {
    expect(overlays.dialog).toBeTruthy()
    expect(overlays.dialog!.left).toBeGreaterThanOrEqual(0)
    expect(overlays.dialog!.right).toBeLessThanOrEqual(overlays.dialog!.width)
  })

  it('the search in the drawer and the bar for selected words fit the screen', () => {
    expect(overlays.search?.hits).toBeGreaterThan(0)
    expect(overlays.search?.over).toBeLessThanOrEqual(0)
    expect(overlays.bar).toBeTruthy()
    expect(overlays.bar!.over).toBeLessThanOrEqual(0)
    // Two rows at most: the colours, and what can be done.
    expect(overlays.bar!.height).toBeLessThan(110)
  })
})
