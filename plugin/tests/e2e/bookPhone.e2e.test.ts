/**
 * A book on a phone: `app.emulateMobile(true)` in a 390×844 window, a plain book, the author's
 * test book and one with contents and notes opened in turn. Each is asked whether the reader
 * reaches past the screen or under Obsidian's floating header and bar, how far below the header
 * the text starts, whether the page shows text at all, and whether a tap on the right edge and a
 * swipe to the left each turn the page. The contents drawer and the text and layout dialog are
 * opened over the last one. A picture of each goes to `/tmp/abele-phone/book-*.png` — look at
 * them.
 *
 * On the desktop, what cannot be checked is WebKit (the iPhone's engine), the system's
 * long-press text selection, and a real finger's swipe. Run on a real phone
 * (`npm run test:e2e:phone`), the tap and the swipe are a finger's, through the screen.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  phoneEntry,
  reloadApp,
} from './helpers/obsidianCli'
import { buildPlainEpub } from '../fixtures/books/maliciousBook'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const PHONE = { width: 390, height: 844 }
const SHOTS = shotDir('abele-phone')
const DIR = 'Abele reader phone e2e'
const available = isObsidianRunning() && hasTestApi()

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A phone's window is its screen: measured, never set. */
const windowSize = (): [number, number] =>
  onPhone()
    ? evalJson<[number, number]>(`[innerWidth, innerHeight]`)
    : evalJson<[number, number]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)

const setWindowSize = async (width: number, height: number): Promise<void> => {
  if (onPhone()) return
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

const reload = async (how: string): Promise<void> => {
  await reloadApp(how)
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
  solid?: boolean
}

/** Each is long on a phone: see `evalLong`. */
const measure = async (name: string): Promise<Screen> =>
  JSON.parse(
    await evalLong(
      `(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const until = async (fn, ms = 15000) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
      return null
    }
    const painted = () => Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))), new Promise((r) => setTimeout(r, 250))])
    /** Until a reading is there and holds for four polls in a row; null if it never does. */
    const steady = async (read, ms = 8000) => {
      let previous = null, still = 0
      return until(() => {
        const value = read()
        const key = value == null ? null : JSON.stringify(value)
        still = key !== null && key === previous ? still + 1 : 0
        previous = key
        return still >= 3
      }, ms)
    }
    const box = (el) => { const b = el?.getBoundingClientRect(); return b ? [b.left, b.top, b.width, b.height] : null }
    /** The page loaded and the reader, its page and the phone's bars laid out and holding still. */
    const laidOut = async (leaf) => {
      await steady(() => {
        const engine = leaf.view.engine, doc = engine.renderer.getContents()[0]?.doc
        if (doc?.readyState !== 'complete' || doc.fonts.status !== 'loaded') return null
        return [box(engine), box(leaf.view.contentEl.querySelector('.abele-book-reader')),
          box(document.querySelector('.mobile-navbar')), box(leaf.view.containerEl.querySelector('.view-header')),
          box(doc.defaultView.frameElement), engine.lastLocation?.cfi ?? null, engine.lastLocation?.fraction ?? null]
      })
      await painted()
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
      await laidOut(leaf)
      const engine = view.engine
      // From the start: a book opens where the last run left it, which may be its last page.
      if (engine.lastLocation.fraction > 0) {
        await engine.goTo(${JSON.stringify(name)}.endsWith('-pdf') ? 0 : engine.book.toc?.[0]?.href ?? 0)
        await laidOut(leaf)
      }
      const r = engine.getBoundingClientRect()
      const whole = view.contentEl.querySelector('.abele-book-reader').getBoundingClientRect()
      report.over = Math.max(0, Math.round(Math.max(r.right, whole.right) - window.innerWidth))
      // The reader keeps clear of Obsidian's floating header and navigation bar.
      const bar = document.querySelector('.mobile-navbar')?.getBoundingClientRect()
      report.underBar = bar && bar.height ? Math.max(0, Math.round(whole.bottom - bar.top)) : 0
      const header = leaf.view.containerEl.querySelector('.view-header')?.getBoundingClientRect()
      const primary = getComputedStyle(view.contentEl).getPropertyValue('--background-primary').trim()
      const swatch = document.createElement('div')
      swatch.style.backgroundColor = primary
      view.contentEl.append(swatch)
      const expectedBackground = getComputedStyle(swatch).backgroundColor
      swatch.remove()
      report.solid = [view.containerEl.querySelector('.view-header'), view.contentEl.querySelector('.abele-book-reader__foot')]
        .every(el => el && getComputedStyle(el).backgroundColor === expectedBackground)
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

      // On a real phone the harness's host takes the picture, and the tap and swipe below are
      // a finger's on the screen (see helpers/phone.ts).
      const host = window.__e2eHost
      const shot = ${JSON.stringify(SHOTS)} + '/book-' + ${JSON.stringify(name)} + '.png'
      if (host) report.shot = await host.shot(shot)
      else require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
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
      // Keep delivery evidence for an intermittent native tap without replaying it.
      const tapEvents = []
      const recordTap = e => tapEvents.push({ type:e.type, trusted:e.isTrusted, time:e.timeStamp,
        target:e.target?.tagName, prevented:e.defaultPrevented, selected:String(page.doc.getSelection()) })
      const tapTypes = ['pointerdown','pointerup','touchstart','touchend','click']
      const tapOwners = [page.doc, engine.renderer]
      for (const owner of tapOwners) for (const type of tapTypes) owner.addEventListener(type,recordTap,true)
      report.tap = { point:[r.right-10,r.top+r.height/2], frame:[frame.left,frame.top,frame.width,frame.height],
        hit:page.doc.elementFromPoint(Math.max(0,x),y)?.tagName,
        selected:String(page.doc.getSelection()), bar:!!(view.model.selection||view.model.active), events:tapEvents }
      try {
        if (host) await host.tap(r.right - 10, r.top + r.height / 2)
        else page.doc.elementFromPoint(Math.max(0, x), y)?.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: page.doc.defaultView, clientX: x, clientY: y }))
        report.turned = !!await until(() => engine.lastLocation.fraction > before, 5000)
      } finally {
        for (const owner of tapOwners) for (const type of tapTypes) owner.removeEventListener(type,recordTap,true)
      }

      // A finger swiped from right to left turns the page too, once the turn above has come to rest.
      await steady(() => [engine.lastLocation.fraction, engine.renderer.start ?? null])
      const swipeFrom = engine.lastLocation.fraction
      const doc = engine.renderer.getContents()[0].doc
      const target = doc.body
      const touch = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: 300, screenX: x, screenY: 300 })
      const fire = (type, x) => target.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [touch(x)],
        changedTouches: [touch(x)] }))
      if (host) {
        const mid = r.top + r.height / 2
        await host.swipe(r.right - 40, mid, r.left + 40, mid)
      } else {
        fire('touchstart', 300)
        for (let x = 280; x >= 80; x -= 40) { await wait(16); fire('touchmove', x) }
        fire('touchend', 80)
      }
      report.swiped = !!await until(() => engine.lastLocation.fraction > swipeFrom, 5000)
    } catch (e) {
      // The message too: WebKit's stack does not carry it.
      report.error = String(e && e.message) + '\\n' + String((e && e.stack) || e)
    }
    return report
  })()`,
      120_000
    )
  ) as Screen

describe.skipIf(!available)('a book on a phone', () => {
  let size: [number, number] = [0, 0]
  let savedReader: unknown = null
  const screens: Record<string, Screen> = {}
  let overlays: {
    drawer?: {
      left: number
      right: number
      width: number
      aboveNavbar: boolean
      backdrop: string
      rows: number
    } | null
    history?: { back: boolean; forward: boolean }
    aboveNavbar?: boolean
    afterPick?: { panel: boolean; chapter: string }
    dialog?: { left: number; right: number; width: number } | null
    search?: {
      hits: number
      over: number
      closeInside: boolean
      stripInside: boolean
      focusOutside: boolean
      focusedRingInside: boolean
    }
    bar?: {
      over: number
      height: number
      left: number
      scrolled: boolean
      lastActionReachable: boolean
    } | null
    speech?: { over: number; bottom: number; height: number; rows: number } | null
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
    // The PDF is measured with pages to turn; its continuous scroll has a file of its own.
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    evalRaw(
      `(async () => {
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, pdfLayout: 'paginated' }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      30_000
    )
    size = windowSize()
    await reload(phoneEntry(PHONE.width, PHONE.height))
    screens.plain = await measure('plain')
    screens['epub-test'] = await measure('epub-test')
    screens['plain-pdf'] = await measure('plain-pdf')
    screens.rich = await measure('rich')
    overlays = JSON.parse(
      await evalLong(
        `(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const until = async (fn, ms = 5000) => {
        const deadline = Date.now() + ms
        while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
        return null
      }
      const painted = () => Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))), new Promise((r) => setTimeout(r, 250))])
      const box = (el) => { const b = el?.getBoundingClientRect(); return b ? [b.left, b.top, b.width, b.height] : null }
      /** Until an element is there, done moving and holding still for four polls in a row. */
      const still = async (find, ms = 5000) => {
        let previous = null, count = 0
        await until(() => {
          const el = find()
          const moving = el?.getAnimations?.({ subtree: true })
            .some((a) => a.playState === 'running' && a.effect?.getTiming?.().iterations !== Infinity)
          const key = !el || moving ? null : JSON.stringify(box(el))
          count = key !== null && key === previous ? count + 1 : 0
          previous = key
          return count >= 3
        }, ms)
        await painted()
      }
      const shoot = async (name) => {
        if (window.__e2eHost) return window.__e2eHost.shot(${JSON.stringify(SHOTS)} + '/book-' + name + '.png')
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
      await until(() => view.contentEl.querySelector('.abele-book-contents .tree-item-self'))
      await still(() => view.contentEl.querySelector('.abele-book-reader__panel'))
      const panel = view.contentEl.querySelector('.abele-book-reader__panel')?.getBoundingClientRect()
      const navbarTop = () => document.querySelector('.mobile-navbar').getBoundingClientRect().top
      report.drawer = panel ? { left: Math.round(panel.left), right: Math.round(panel.right), width: innerWidth,
        aboveNavbar: panel.bottom <= navbarTop() + 1,
        backdrop: getComputedStyle(view.contentEl.querySelector('.abele-book-reader__backdrop')).display,
        rows: view.contentEl.querySelectorAll('.abele-book-contents .tree-item-self').length } : null
      await shoot('rich-contents')
      // Picking a chapter in the drawer closes it and goes there.
      ;[...view.contentEl.querySelectorAll('.abele-book-contents .tree-item-self')].find((row) => row.textContent.trim() === 'Chapter 2')?.click()
      await until(() => !view.model.panel && view.model.chapter === 'Chapter 2' &&
        !view.contentEl.querySelector('.abele-book-reader__panel'))
      await still(() => view.contentEl.querySelector('.abele-book-reader'))
      report.afterPick = { panel: view.model.panel, chapter: view.model.chapter }
      const back = view.contentEl.querySelector('.abele-book-reader__footer > :first-child .lucide-undo-2')
      await shoot('rich-jump-back')
      await view.engine.history.back()
      await until(() => view.model.canGoForward)
      await still(() => view.contentEl.querySelector('.abele-book-reader__footer'))
      report.history = { back: !!back, forward: !!view.contentEl.querySelector('.abele-book-reader__footer .lucide-redo-2') }
      await shoot('rich-return-forward')
      await view.engine.history.forward()
      await until(() => view.model.chapter === 'Chapter 2')
      view.model.settingsOpen = true
      await still(() => document.querySelector('.modal-container .modal'))
      const dialog = document.querySelector('.modal-container .modal')?.getBoundingClientRect()
      report.dialog = dialog ? { left: Math.round(dialog.left), right: Math.round(dialog.right), width: window.innerWidth } : null
      await shoot('rich-settings')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await until(() => !document.querySelector('.modal-container'))

      // The search in the drawer, with what it found.
      view.model.panelTab = 'search'
      view.model.panel = true
      await still(() => view.contentEl.querySelector('.abele-book-reader__panel'))
      await view.reading.search('plain text')
      await until(() => view.contentEl.querySelector('.abele-book-search__hit'))
      await still(() => view.contentEl.querySelector('.abele-book-reader__panel'))
      const edge = (sel, skipScrollContents = false) => {
        let over = 0
        const walk = (el) => {
          const r = el.getBoundingClientRect()
          if (r.width) over = Math.max(over, Math.round(r.right - window.innerWidth))
          // A tab inside a sideways scrolling strip can be offscreen by design. The strip
          // itself and every other element in the drawer must still fit the phone screen.
          const style = getComputedStyle(el)
          if (skipScrollContents && (style.overflowX === 'auto' || style.overflowX === 'scroll')) return
          for (const child of el.children) walk(child)
        }
        const root = view.contentEl.querySelector(sel)
        if (root) walk(root)
        return over
      }
      const searchPanel = view.contentEl.querySelector('.abele-book-reader__panel')
      const head = searchPanel.querySelector('.abele-book-reader__panel-head')
      const close = head.querySelector(':scope > .abele-obsidian-icon')?.getBoundingClientRect()
      const strip = head.querySelector('.abele-book-reader__panel-tabs')?.getBoundingClientRect()
      const panelRight = searchPanel.getBoundingClientRect().right
      const tabStrip = head.querySelector('.abele-book-reader__panel-tabs')
      const lastTab = tabStrip.querySelector('.abele-book-reader__panel-tab:last-child')
      const scrollBefore = tabStrip.scrollLeft
      document.activeElement?.blur()
      tabStrip.scrollLeft = 0
      const focusOutside = lastTab.getBoundingClientRect().right > tabStrip.getBoundingClientRect().right
      lastTab.focus() // As keyboard focus does, without preventScroll or a probe-side scroll.
      const focused = lastTab.getBoundingClientRect()
      const bounds = tabStrip.getBoundingClientRect()
      const shadow = (getComputedStyle(lastTab).boxShadow.match(/-?\\d+(\\.\\d+)?px/g) || []).map(parseFloat)
      const reach = shadow.length >= 4 ? Math.max(0, shadow[2]) + Math.max(0, shadow[3]) : 0
      const focusedRingInside = focused.left - reach >= bounds.left && focused.right + reach <= bounds.right
      lastTab.blur()
      tabStrip.scrollLeft = scrollBefore
      report.search = {
        hits: view.contentEl.querySelectorAll('.abele-book-search__hit').length,
        over: edge('.abele-book-reader__panel', true),
        closeInside: !!close && close.right <= panelRight,
        stripInside: !!strip && strip.right <= panelRight,
        focusOutside,
        focusedRingInside,
      }
      await shoot('rich-search')
      view.model.panel = false
      view.reading.stopSearch()
      await until(() => !view.contentEl.querySelector('.abele-book-reader__panel'))
      await still(() => view.contentEl.querySelector('.abele-book-reader'))

      // Words selected: the bar viewport fits the screen; its single action row scrolls sideways.
      const doc = view.engine.renderer.getContents()[0].doc
      const p = doc.querySelector('p')
      const range = doc.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 5)
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      for (let i = 0; i < 30 && !view.model.selection; i++) await wait(100)
      // The bar comes once the words have rested: it stays hidden while they are being selected.
      for (let i = 0; i < 30 && !view.contentEl.querySelector('.abele-book-selection'); i++) await wait(100)
      await still(() => view.contentEl.querySelector('.abele-book-selection'))
      const barEl = view.contentEl.querySelector('.abele-book-selection')
      const bar = barEl?.getBoundingClientRect()
      report.aboveNavbar = !!bar && bar.bottom <= navbarTop() + 1
      if (bar) {
        const last = [...barEl.querySelectorAll('[role="button"],button')].at(-1)
        barEl.scrollLeft = barEl.scrollWidth
        await painted()
        const end = last?.getBoundingClientRect()
        report.bar = { over: edge('.abele-book-selection', true), left:bar.left, height:Math.round(bar.height),
          scrolled:barEl.scrollLeft > 0,
          lastActionReachable:!!end && end.width > 0 && end.left >= bar.left && end.right <= bar.right + 1 }
        barEl.scrollLeft = 0
      } else report.bar = null
      await shoot('rich-selection')
      view.reading.clearSelection()
      await until(() => !view.model.selection && !view.contentEl.querySelector('.abele-book-selection'))

      // Reading aloud, with a silent stand-in for speech that never finishes its sentence: the
      // bar under the page fits, and the sentence is marked.
      const hooks = window.__abeleTest.reader.hooks
      hooks.speech = {
        speech: { speak() {}, cancel() {}, pause() {}, resume() {}, getVoices: () => [] },
        make: (text) => ({ text }),
      }
      view.reading.speech.stop()
      view.reading.speech.toggle()
      await still(() => view.contentEl.querySelector('.abele-book-speech'))
      const speaking = view.contentEl.querySelector('.abele-book-speech')?.getBoundingClientRect()
      report.aboveNavbar = report.aboveNavbar && !!speaking && speaking.bottom <= navbarTop() + 1
      report.speech = speaking
        ? { over: edge('.abele-book-speech'), bottom: Math.round(speaking.bottom), height: window.innerHeight, rows: Math.round(speaking.height) }
        : null
      await shoot('rich-speech')
      view.reading.speech.stop()
      hooks.speech = null
      return report
    })()`,
        120_000
      )
    ) as typeof overlays
    console.info(`\n  ${JSON.stringify(overlays)}\n`)
    console.info(`\n  ${JSON.stringify(screens)}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        // Kept on this side: the app is reloaded in between, and the page's memory with it.
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
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
      expect(screens[name]?.solid).toBe(true)
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

  it('the contents fill the phone above the navbar, and close when a chapter is picked', () => {
    expect(overlays.drawer?.left).toBe(0)
    expect(overlays.drawer!.right).toBe(overlays.drawer!.width)
    expect(overlays.drawer!.aboveNavbar).toBe(true)
    expect(overlays.drawer!.backdrop).toBe('none')
    expect(overlays.drawer!.rows).toBeGreaterThanOrEqual(4)
    expect(overlays.afterPick?.panel).toBe(false)
    expect(overlays.afterPick?.chapter).toBe('Chapter 2')
  })

  it('keeps selection and speech above the navbar and exposes jump history at the row start', () => {
    expect(overlays.aboveNavbar).toBe(true)
    expect(overlays.history).toEqual({ back: true, forward: true })
  })

  it('the text and layout dialog fits the screen', () => {
    expect(overlays.dialog).toBeTruthy()
    expect(overlays.dialog!.left).toBeGreaterThanOrEqual(0)
    expect(overlays.dialog!.right).toBeLessThanOrEqual(overlays.dialog!.width)
  })

  it('the search in the drawer and the bar for selected words fit the screen', () => {
    expect(overlays.search?.hits).toBeGreaterThan(0)
    expect(overlays.search?.over).toBeLessThanOrEqual(0)
    expect(overlays.search?.stripInside).toBe(true)
    expect(overlays.search?.closeInside).toBe(true)
    // The tabs are a row of glyphs now: the last one is in view without scrolling the row.
    expect(overlays.search?.focusOutside).toBe(false)
    expect(overlays.search?.focusedRingInside).toBe(true)
    expect(overlays.bar).toBeTruthy()
    expect(overlays.bar!.over).toBeLessThanOrEqual(0)
    expect(overlays.bar!.left).toBeGreaterThanOrEqual(0)
    expect(overlays.bar!.scrolled).toBe(true)
    expect(overlays.bar!.lastActionReachable).toBe(true)
    // The single scrollable row must not take extra page height.
    expect(overlays.bar!.height).toBeLessThan(110)
  })

  it('the bar for reading aloud fits the screen, on one row', () => {
    expect(overlays.speech).toBeTruthy()
    expect(overlays.speech!.over).toBeLessThanOrEqual(0)
    expect(overlays.speech!.bottom).toBeLessThanOrEqual(overlays.speech!.height)
    expect(overlays.speech!.rows).toBeLessThan(60)
  })
})
