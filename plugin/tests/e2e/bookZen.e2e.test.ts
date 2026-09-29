/**
 * Zen mode in the running app (`src/reader/zen.ts`, `zenChrome.ts`), switched by its command:
 *
 * - on the desktop the tab's header and the row under the page go, the page grows into their
 *   room and a highlight stays on its words; the mouse at the top of the tab brings the header
 *   back over the page without laying it out again; Esc leaves the mode and puts it all back;
 * - under `emulateMobile` at a phone's size, Obsidian's own navigation is hidden its own way,
 *   the page grows, a tap in the middle of the page brings the chrome back over it — the page not
 *   laid out again — and it goes by itself; words selected bring up their bar; switched off,
 *   the tab is as before.
 *
 * The mode is kept in the app's local storage; it is put back to off, and the window to the
 * desktop and its size, when the file ends. Pictures go to `/tmp/abele-phone/zen-*.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildProseEpub } from '../fixtures/books/proseBook'
import { targets } from './helpers/target'

targets('desktop')

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader zen e2e'
const PROSE = `${DIR}/prose.epub`
const SHOTS = '/tmp/abele-phone'
const WINDOW = `require('@electron/remote').getCurrentWindow()`

const reload = async (how: string): Promise<void> => {
  await reloadApp(how)
  runCli(['dev:debug', 'on'], 30_000)
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`
  )
}

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const api = window.__abeleTest.reader
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  const open = async (path) => {
    const old = app.workspace.getLeavesOfType('abele-book')
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
    for (const l of old) if (l !== leaf) l.detach()
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready' && view.reading, 15000)
    if (view.model.panel) { view.model.panel = false }
    await wait(800)
    return { leaf, view }
  }
  const press = async (key, code, keyCode) => {
    await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
    await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
    await wait(700)
  }
  const tap = async (x, y) => {
    const p = [{ x: Math.round(x), y: Math.round(y), id: 0 }]
    await cdp.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p })
    await wait(60)
    await cdp.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await wait(600)
  }
  const toggle = () => app.commands.executeCommandById('abele:reader-toggle-zen')
  const R = (view) => view.engine.renderer
  const contents = (view) => R(view).getContents()[0]
  const stage = (view) => view.contentEl.querySelector('.abele-book-reader__stage')
  const height = (view) => Math.round(stage(view).getBoundingClientRect().height)
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0
  const header = (view) => view.containerEl.querySelector(':scope > .view-header')
  const foot = (view) => view.contentEl.querySelector('.abele-book-reader__foot')
  /** Where the highlight is drawn and where its words are, a line each. */
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
  /** Words on the page on screen highlighted yellow; returns the highlight's place. */
  const highlight = async (view) => {
    // The page is found again on every try: one still settling after the app came up may be
    // laid out anew under the selection.
    let doc = null
    // Words highlighted already — by the desktop's run of the same book — come back as that
    // highlight rather than as a selection.
    const picked = () => view.model.selection || view.model.active
    for (let i = 0; i < 5 && !picked(); i++) {
      doc = contents(view).doc
      const p = [...doc.querySelectorAll('p')].find((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.left >= 0 && (el.firstChild?.length ?? 0) > 80
      })
      const range = doc.createRange()
      range.setStart(p.firstChild, 10); range.setEnd(p.firstChild, 60)
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      await until(picked, 2000)
    }
    if (!picked()) throw new Error('nothing selected: ' + doc.getSelection().toString().length)
    const cfi = picked().cfi
    if (view.model.selection) await view.reading.highlight('yellow')
    doc.getSelection().removeAllRanges()
    view.model.active = null
    await until(() => contents(view).overlayer.element.querySelector('rect'), 5000)
    await until(() => !view.model.selection && !view.model.active, 3000)
    await wait(500)
    return cfi
  }
  /**
   * Words on the last line of text on screen selected, as a finger or the mouse leaves them, and
   * whether the bar for them covers them: the words' boxes and the bar's, in the window.
   */
  const selectLastLine = async (view, name) => {
    // A page whose text ends above the bar's place — a paragraph that did not fit — does not
    // show the case: the next page is tried.
    for (let i = 0; i < 6; i++) {
      const out = await selectLastLineHere(view, name)
      if (out.wouldCover) return out
      await view.engine.next()
      await wait(800)
    }
    return selectLastLineHere(view, name)
  }
  const selectLastLineHere = async (view, name) => {
    const doc = contents(view).doc
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const box = stage(view).getBoundingClientRect()
    // The last letter shown on the page, found letter by letter in the paragraphs on screen.
    const inside = (r) =>
      r.width > 0 && r.left + frame.left >= box.left && r.right + frame.left <= box.right &&
      r.top + frame.top >= box.top && r.bottom + frame.top <= box.bottom
    const letter = doc.createRange()
    let end = null
    const walker = doc.createTreeWalker(doc.body, 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const p = node.parentElement.getBoundingClientRect()
      if (p.right + frame.left < box.left || p.left + frame.left > box.right) continue
      for (let i = 0; i < node.length; i++) {
        letter.setStart(node, i); letter.setEnd(node, i + 1)
        if (node.data[i].trim() && inside(letter.getBoundingClientRect())) end = { node, i }
      }
    }
    if (!end) throw new Error('no text on the page')
    const range = doc.createRange()
    range.setStart(end.node, Math.max(0, end.i - 4)); range.setEnd(end.node, end.i + 1)
    if (range.getClientRects().length > 1) range.setStart(end.node, end.i)
    doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
    await until(() => view.model.selection, 3000)
    await wait(600)
    const words = [...range.getClientRects()].map((r) => ({ top: r.top + frame.top, bottom: r.bottom + frame.top }))
    const f = foot(view).getBoundingClientRect()
    const covered = words.some((w) => w.bottom > f.top + 1 && w.top < f.bottom - 1)
    // Where the bar lies when it is at the page's foot: the words must be there, or the case the
    // step is for never came up.
    const wouldCover = words.some((w) => w.bottom > box.bottom - f.height + 1)
    if (name && wouldCover) await shot(name)
    const out = { foot: shown(foot(view)), covered, wouldCover, words: words.map((w) => Math.round(w.top)), bar: [Math.round(f.top), Math.round(f.bottom)], page: [Math.round(box.top), Math.round(box.bottom)], height: height(view) }
    doc.getSelection().removeAllRanges()
    await until(() => !view.model.selection, 3000)
    await wait(300)
    return out
  }
  const shot = async (name) => {
    const img = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/zen-' + name + '.png', img.toPNG())
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    110_000
  )

type Boxes = { drawn: number[][]; words: number[][] }
type Last = {
  foot: boolean
  covered: boolean
  wouldCover: boolean
  words: number[]
  bar: number[]
  page: number[]
  height: number
}

/** The bar for words on the last line shows, covers none of them, and moves nothing. */
const uncovered = (name: string, last: Last | undefined, height: number | undefined) => {
  expect(last?.wouldCover, `${name}: words ${last?.words} in the bar's place at the foot`).toBe(
    true
  )
  expect(last?.foot, `${name}: the bar shows`).toBe(true)
  expect(last?.covered, `${name}: words ${last?.words} under the bar ${last?.bar}`).toBe(false)
  expect(last?.height, `${name}: the page not laid out anew`).toBe(height)
}

const onWords = (name: string, b: Boxes | undefined) => {
  expect(b?.drawn.length, `${name}: boxes drawn`).toBeGreaterThan(0)
  expect(b?.drawn.length, `${name}: one box per line`).toBe(b?.words.length)
  b?.drawn.forEach((d, i) => {
    expect(Math.abs(d[0] - b.words[i][0]), `${name}: box ${i} left`).toBeLessThanOrEqual(1)
    expect(Math.abs(d[1] - b.words[i][1]), `${name}: box ${i} top`).toBeLessThanOrEqual(1)
  })
}

describe.skipIf(!available)('zen mode', () => {
  let size: [number, number] = [0, 0]
  let savedReader: unknown = null

  beforeAll(async () => {
    if (evalRaw(`String(app.isMobile)`) === 'true') await reload('app.emulateMobile(false)')
    size = evalJson<[number, number]>(`${WINDOW}.getContentSize()`)
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    const data = Buffer.from(buildProseEpub()).toString('base64')
    evalRaw(
      `(async () => {
        window.__abeleTest.reader.zen.set(false)
        ${WINDOW}.setContentSize(1280, 800)
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(PROSE)}, bytes.buffer)
        // The narrow margin: the last line of a page then always lies where the bar for words
        // would at the page's foot.
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, margin: 'narrow' }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      44_000
    )
    runCli(['dev:debug', 'on'], 30_000)
  }, 90_000)

  afterAll(async () => {
    const clean = `(async () => {
        window.__abeleTest.reader.zen.set(false)
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        for (const leaf of app.workspace.getLeavesOfType('markdown'))
          if (leaf.view.file?.path?.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
        return 'ok'
      })()`
    evalRaw(clean, 44_000)
    if (evalRaw(`String(app.isMobile)`) === 'true') await reload('app.emulateMobile(false)')
    if (size[0])
      evalRaw(`(() => { ${WINDOW}.setContentSize(${size[0]}, ${size[1]}); return 'ok' })()`)
  }, 120_000)

  it('on the desktop, gives the page the room of the header and the row under it, and Esc puts them back', () => {
    const r = run<{
      error?: string
      before?: { height: number; header: boolean; foot: boolean; boxes: Boxes }
      zen?: { height: number; header: boolean; foot: boolean; boxes: Boxes; cls: boolean }
      peek?: { height: number; header: boolean; headerTop: number; pageTop: number }
      peekGone?: boolean
      selected?: { foot: boolean; height: number }
      last?: Last
      after?: { height: number; header: boolean; foot: boolean; boxes: Boxes; on: boolean }
    }>(`
      api.zen.set(false)
      const { view } = await open(${JSON.stringify(PROSE)})
      await view.engine.goTo(view.model.toc[0].href); await wait(600)
      const cfi = await highlight(view)
      const state = () => ({ height: height(view), header: shown(header(view)), foot: shown(foot(view)), boxes: boxes(view, cfi) })
      const before = state()

      await toggle()
      await until(() => height(view) > before.height + 40, 5000)
      await wait(1500)
      const zen = { ...state(), cls: view.containerEl.classList.contains('abele-book_zen') }
      await shot('desktop')

      // The mouse at the top of the tab: the header over the page, the page as it was.
      view.containerEl.querySelector('.abele-book-zen-edge').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await wait(500)
      const peek = {
        height: height(view),
        header: shown(header(view)),
        headerTop: Math.round(header(view).getBoundingClientRect().top),
        pageTop: Math.round(stage(view).getBoundingClientRect().top),
      }
      await shot('desktop-peek')
      // And away from it: gone a moment later.
      stage(view).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await wait(1500)
      const peekGone = !shown(header(view)) && !view.model.zenPeek

      // Words selected bring up their bar, over the page.
      const doc = contents(view).doc
      const p = [...doc.querySelectorAll('p')].find((el) => el.getBoundingClientRect().width > 0 && (el.firstChild?.length ?? 0) > 80)
      const range = doc.createRange(); range.setStart(p.firstChild, 2); range.setEnd(p.firstChild, 8)
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      await wait(400)
      const selected = { foot: shown(foot(view)), height: height(view) }
      doc.getSelection().removeAllRanges()
      await until(() => !view.model.selection, 3000)
      await wait(300)
      // Words on the last line: the bar goes where it covers none of them.
      const last = await selectLastLine(view, 'desktop-last-line')

      // Esc, as the keyboard sends it, to whatever holds the focus.
      view.takeFocus()
      await press('Escape', 'Escape', 27)
      await until(() => height(view) < zen.height - 40, 5000)
      await wait(1500)
      const after = { ...state(), on: api.zen.state().on }
      return { before, zen, peek, peekGone, selected, last, after }
    `)
    expect(r.error).toBeUndefined()
    expect(r.before?.header).toBe(true)
    expect(r.before?.foot).toBe(true)
    onWords('before', r.before?.boxes)

    expect(r.zen?.cls).toBe(true)
    expect(r.zen?.header).toBe(false)
    expect(r.zen?.foot).toBe(false)
    expect(r.zen?.height).toBeGreaterThan((r.before?.height ?? 0) + 40)
    onWords('in zen mode', r.zen?.boxes)

    expect(r.peek?.header).toBe(true)
    expect(r.peek?.height).toBe(r.zen?.height)
    // Over the page, not above it.
    expect(r.peek?.headerTop).toBeLessThanOrEqual((r.peek?.pageTop ?? 0) + 1)
    expect(r.peekGone).toBe(true)

    expect(r.selected?.foot).toBe(true)
    expect(r.selected?.height).toBe(r.zen?.height)
    uncovered('desktop', r.last, r.zen?.height)

    expect(r.after?.on).toBe(false)
    expect(r.after?.header).toBe(true)
    expect(r.after?.foot).toBe(true)
    expect(r.after?.height).toBe(r.before?.height)
    onWords('after zen mode', r.after?.boxes)
  }, 150_000)

  it('on a phone, hides Obsidian’s navigation its own way, and a tap in the middle brings it back for a moment', async () => {
    await reload('app.emulateMobile(true)')
    evalRaw(`(() => { ${WINDOW}.setContentSize(390, 844); return 'ok' })()`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const r = run<{
      error?: string
      phone?: boolean
      before?: { height: number; nav: boolean; boxes: Boxes }
      zen?: { height: number; hidden: boolean; navbarOpacity: string; header: string; boxes: Boxes }
      peek?: { height: number; hidden: boolean; foot: boolean; footBottom: number; navTop: number }
      expired?: { hidden: boolean; foot: boolean }
      last?: Last
      after?: { height: number; hidden: boolean; boxes: Boxes }
    }>(`
      api.zen.set(false)
      const { view } = await open(${JSON.stringify(PROSE)})
      await view.engine.goTo(view.model.toc[0].href); await wait(800)
      const cfi = await highlight(view)
      const navbar = document.querySelector('.mobile-navbar')
      const before = { height: height(view), nav: !!navbar, boxes: boxes(view, cfi) }
      await shot('phone-before')

      await toggle()
      await until(() => height(view) > before.height + 40, 5000)
      await wait(1500)
      const zen = {
        height: height(view),
        hidden: document.body.classList.contains('is-hidden-nav'),
        navbarOpacity: navbar ? getComputedStyle(navbar).opacity : 'none',
        header: getComputedStyle(header(view)).opacity,
        boxes: boxes(view, cfi),
      }
      await shot('phone-zen')

      // A tap in the middle of the page, as a finger taps.
      const box = stage(view).getBoundingClientRect()
      await tap(box.left + box.width / 2, box.top + box.height / 2)
      await wait(600)
      const f = foot(view)
      const peek = {
        height: height(view),
        hidden: document.body.classList.contains('is-hidden-nav'),
        foot: shown(f),
        footBottom: Math.round(f.getBoundingClientRect().bottom),
        navTop: navbar ? Math.round(navbar.getBoundingClientRect().top) : 0,
      }
      await shot('phone-peek')
      await wait(4500)
      const expired = { hidden: document.body.classList.contains('is-hidden-nav'), foot: shown(foot(view)) }
      const last = await selectLastLine(view, 'phone-last-line')

      await toggle()
      await until(() => height(view) < zen.height - 40, 5000)
      await wait(1500)
      const after = { height: height(view), hidden: document.body.classList.contains('is-hidden-nav'), boxes: boxes(view, cfi) }
      return { phone: app.isMobile, before, zen, peek, expired, last, after }
    `)
    expect(r.error).toBeUndefined()
    expect(r.phone).toBe(true)
    onWords('phone, before', r.before?.boxes)

    expect(r.zen?.hidden).toBe(true)
    expect(r.zen?.header).toBe('0')
    if (r.before?.nav) expect(r.zen?.navbarOpacity).toBe('0')
    expect(r.zen?.height).toBeGreaterThan((r.before?.height ?? 0) + 40)
    onWords('phone, in zen mode', r.zen?.boxes)

    expect(r.peek?.hidden).toBe(false)
    expect(r.peek?.foot).toBe(true)
    expect(r.peek?.height).toBe(r.zen?.height)
    // The row under the page sits above Obsidian's bar, not under it.
    if (r.before?.nav) expect(r.peek?.footBottom).toBeLessThanOrEqual((r.peek?.navTop ?? 0) + 1)
    expect(r.expired?.hidden).toBe(true)
    expect(r.expired?.foot).toBe(false)
    uncovered('phone', r.last, r.zen?.height)

    expect(r.after?.hidden).toBe(false)
    expect(r.after?.height).toBe(r.before?.height)
    onWords('phone, after', r.after?.boxes)
  }, 180_000)
})
