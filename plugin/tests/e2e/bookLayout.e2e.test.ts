/**
 * Paragraphs never drawn over each other, in the running app: a book of long Russian paragraphs
 * with footnote marks, on the desktop in two columns and one, and under `emulateMobile` at
 * 390×844. After every change that lays the pages out again — the window resized, a side panel
 * opened or closed, the contents panel, the chapter scrolled for a while and turned back into
 * pages (what a selection carried on does on one column), a column's step and the return to a
 * page's edge (two columns) — every line of every paragraph in the chapter is compared with the
 * lines of the paragraphs after it; a line of one standing on a line of another fails.
 *
 * The probe is checked first against paragraphs made too short on purpose, so a pass means
 * something. Pictures go to `/tmp/abele-phone/layout-*.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, runCli } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildProseEpub, PROSE_BOOK_ID } from '../fixtures/books/proseBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader layout e2e'
const BOOK = `${DIR}/prose.epub`
const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-phone'

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
  // The DevTools debugger the pictures are taken through, which a fresh start leaves detached.
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
  const win = require('@electron/remote').getCurrentWindow()
  const open = async () => {
    let leaf = app.workspace.getLeavesOfType('abele-book')[0]
    if (!leaf) {
      try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
      await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
    }
    await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading)
    await wait(800)
    return leaf.view
  }
  const R = (view) => view.engine.renderer
  const docOf = (view) => R(view).getContents()[0].doc
  /**
   * Every pair of paragraphs, near each other in the chapter, one of whose lines stands on a line
   * of the other: [first id, second id, top of the line].
   */
  const overlaps = (view) => {
    const doc = docOf(view)
    const blocks = [...doc.body.querySelectorAll('p, h1, h2, h3, li, blockquote')]
      .filter((b) => !b.querySelector('p, li, blockquote'))
    const lines = blocks.map((b) => {
      const range = doc.createRange(); range.selectNodeContents(b)
      return [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1)
    })
    const out = []
    for (let i = 0; i < blocks.length; i++)
      for (let j = i + 1; j < Math.min(blocks.length, i + 4); j++)
        for (const a of lines[i]) {
          const hit = lines[j].find((b) =>
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2)
          if (hit) { out.push([blocks[i].id, blocks[j].id, Math.round(a.top)]); break }
        }
    return out
  }
  /** Paragraphs on the page shown, so a check is known to have looked at some. */
  const onPage = (view) => {
    const doc = docOf(view)
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const page = R(view).getBoundingClientRect()
    return [...doc.querySelectorAll('p')].filter((p) => {
      const r = p.getBoundingClientRect()
      const x = r.left + frame.left
      return r.width && x < page.right && x + r.width > page.left
    }).length
  }
  const shoot = async (name) => {
    const shot = await Promise.race([
      require('@electron/remote').getCurrentWebContents().debugger.sendCommand('Page.captureScreenshot', { format: 'png' }).catch(() => null),
      wait(8000).then(() => null),
    ])
    if (shot) {
      require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/layout-' + name + '.png', Buffer.from(shot.data, 'base64'))
    }
  }
  const results = []
  const check = async (view, name, settle = 1000) => {
    await wait(settle)
    results.push({ name, columns: R(view).columns, scrolled: R(view).scrolled, onPage: onPage(view), overlaps: overlaps(view).slice(0, 3) })
  }
  /** A paragraph on the page shown, whole, as the place a flow change keeps. */
  const anchor = (view) => {
    const doc = docOf(view)
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const page = R(view).getBoundingClientRect()
    const p = [...doc.querySelectorAll('p')].find((p) => {
      const r = p.getBoundingClientRect()
      const x = r.left + frame.left, y = r.top + frame.top
      return r.width && x >= page.left && x < page.right && y >= page.top && y < page.bottom
    }) ?? doc.querySelector('p')
    const range = doc.createRange(); range.selectNodeContents(p)
    return range
  }
`

interface Checked {
  name: string
  columns: number
  scrolled: boolean
  onPage: number
  overlaps: unknown[]
  moved?: boolean
  relaid?: boolean
}

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    180_000
  )

/** Every check looked at a page with paragraphs on it and found none drawn over another. */
const expectClean = (results: Checked[]): void => {
  for (const r of results) {
    expect(r.onPage, `${r.name}: paragraphs on the page`).toBeGreaterThan(0)
    expect(r.overlaps, `${r.name}: paragraphs over each other`).toEqual([])
    expect(r.moved ?? false, `${r.name}: the page moved`).toBe(false)
    expect(r.relaid ?? true, `${r.name}: the columns laid out again`).toBe(true)
  }
}

describe.skipIf(!available)('paragraphs are never drawn over each other', () => {
  let savedReader: unknown = null
  let size: [number, number] = [0, 0]

  beforeAll(() => {
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    size = windowSize()
    const data = Buffer.from(buildProseEpub()).toString('base64')
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, flow: 'paginated', columns: 2, font: 'theme', lineHeight: 1.5, fontSize: 100 }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(async () => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        // The fixture vault holds nothing of the tests' own afterwards.
        const places = cfg.reader?.placesPath || 'abele-book-places.json'
        if (await app.vault.adapter.exists(places)) await app.vault.adapter.remove(places)
        return 'ok'
      })()`,
      60_000
    )
    if (evalJson<boolean>('app.isMobile')) await reload('app.emulateMobile(false)')
    if (size[0]) await setWindowSize(size[0], size[1])
  }, 180_000)

  it('a place the book does not have, from another edition of it, opens it at its start', () => {
    const r = run<{ error?: string; status?: string; message?: string; chapter?: string }>(`
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      const path = window.__abeleTest.AbeleConfig.getInstance().reader?.placesPath || 'abele-book-places.json'
      const file = app.vault.getAbstractFileByPath(path)
      const places = file ? JSON.parse(await app.vault.read(file)) : {}
      places['id:' + ${JSON.stringify(PROSE_BOOK_ID)}] = {
        cfi: 'epubcfi(/6/2!/4/2/14,/12[gone]/1:1023,/24[gone]/1:895)', fraction: 0.4, path: ${JSON.stringify(BOOK)}, at: Date.now(),
      }
      if (file) await app.vault.modify(file, JSON.stringify(places))
      else await app.vault.create(path, JSON.stringify(places))
      await wait(1500)
      let leaf
      try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
      await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
      await until(() => ['ready', 'error'].includes(leaf.view?.model?.status))
      await wait(500)
      return { status: leaf.view.model.status, message: leaf.view.model.message, chapter: leaf.view.model.chapter }
    `)
    expect(r.error).toBeUndefined()
    expect(r.status, r.message).toBe('ready')
    expect(r.chapter).toMatch(/^Глава 1/)
  })

  it('the probe finds paragraphs drawn over each other when there are some', () => {
    const r = run<{ error?: string; found: number }>(`
      const view = await open()
      const doc = docOf(view)
      const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style')
      style.textContent = 'p { height: 1.5em; }'
      doc.head.append(style)
      await wait(600)
      const found = overlaps(view).length
      style.remove()
      await wait(600)
      return { found }
    `)
    expect(r.error).toBeUndefined()
    expect(r.found).toBeGreaterThan(0)
  })

  it('on the desktop, in two columns and one, whatever lays the pages out again', async () => {
    await setWindowSize(1512, 982)
    const r = run<{ error?: string; results: Checked[] }>(`
      const view = await open()
      const r = R(view)
      const left = app.workspace.leftSplit, right = app.workspace.rightSplit
      const wasLeft = left.collapsed, wasRight = right.collapsed
      left.collapse(); right.collapse(); view.model.panel = false
      await check(view, 'wide, two columns', 1500)
      await shoot('desktop-wide')
      for (let i = 0; i < 3; i++) { await r.next(); await wait(300) }
      await check(view, 'three pages on')
      // Fonts arriving lay the columns out again; a page that was right does not move.
      const first = () => { const b = anchor(view).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.height)] }
      const before = [r.start, ...first()]
      const nudges = []
      const watcher = new MutationObserver((m) => nudges.push(...m))
      watcher.observe(docOf(view).documentElement, { attributes: true, attributeFilter: ['style'] })
      docOf(view).fonts.dispatchEvent(new Event('loadingdone'))
      await check(view, 'fonts arrived', 600)
      watcher.disconnect()
      results[results.length - 1].moved = JSON.stringify([r.start, ...first()]) !== JSON.stringify(before)
      results[results.length - 1].relaid = nudges.length >= 2
      win.setContentSize(1300, 860); await check(view, 'narrower')
      win.setContentSize(1700, 1040); await check(view, 'wider')
      win.setContentSize(1512, 982); await check(view, 'back')
      left.expand(); await check(view, 'left side panel open')
      right.expand(); await check(view, 'right side panel open')
      left.collapse(); right.collapse(); await check(view, 'side panels closed')
      view.model.panel = true; await check(view, 'contents open')
      view.model.panel = false; await check(view, 'contents closed')
      // Two columns: a selection carried on moves a column, then back to a page's edge.
      const two = r.columns
      await r.stepBy(r.size / 2); await check(view, 'a column on')
      await r.showAnchor(anchor(view)); await check(view, 'back to a page edge')
      // Scrolled for a while in the page's box, and pages again: in two columns, then in one.
      r.setFlow('scrolled', anchor(view), true); await wait(800)
      r.setFlow('paginated', anchor(view), false); await check(view, 'scrolled and back, ' + two + ' columns')
      win.setContentSize(720, 860); await check(view, 'one column')
      r.setFlow('scrolled', anchor(view), true); await wait(800)
      await r.next(r.size / 2); await wait(500)
      r.setFlow('paginated', anchor(view), false); await check(view, 'scrolled and back, one column')
      r.setFlow('scrolled', anchor(view), true); await wait(800)
      win.setContentSize(1512, 982); await wait(1000)
      r.setFlow('paginated', anchor(view), false); await check(view, 'widened while scrolled, back to two')
      await shoot('desktop-after')
      if (!wasLeft) left.expand()
      if (!wasRight) right.expand()
      return { results }
    `)
    expect(r.error).toBeUndefined()
    expect(r.results.some((c) => c.columns === 2)).toBe(true)
    expect(r.results.some((c) => c.columns === 1)).toBe(true)
    expectClean(r.results)
  }, 240_000)

  it('the book restored when the app starts', async () => {
    await setWindowSize(1512, 982)
    await reload('window.location.reload()')
    const r = run<{ error?: string; results: Checked[] }>(`
      const leaf = app.workspace.getLeavesOfType('abele-book')[0]
      if (!leaf) return { error: 'no book tab restored' }
      app.workspace.setActiveLeaf(leaf, { focus: true })
      if (leaf.loadIfDeferred) await leaf.loadIfDeferred()
      const view = await open()
      await check(view, 'restored', 1500)
      await R(view).next(); await check(view, 'restored, a page on')
      return { results }
    `)
    expect(r.error).toBeUndefined()
    expectClean(r.results)
  }, 180_000)

  describe('on a phone', () => {
    beforeAll(async () => {
      await reload('app.emulateMobile(true)')
      await setWindowSize(PHONE.width, PHONE.height)
      await reload('window.location.reload()')
    }, 180_000)

    it('in one column, turned and scrolled for a while', () => {
      const r = run<{ error?: string; results: Checked[] }>(`
        const view = await open()
        const r = R(view)
        await check(view, 'phone', 1500)
        await shoot('phone')
        for (let i = 0; i < 3; i++) { await r.next(); await wait(300) }
        await check(view, 'phone, three pages on')
        r.setFlow('scrolled', anchor(view), true); await wait(800)
        await r.next(r.size / 2); await wait(500)
        r.setFlow('paginated', anchor(view), false); await check(view, 'phone, scrolled and back')
        return { results }
      `)
      expect(r.error).toBeUndefined()
      expect(r.results.every((c) => c.columns === 1)).toBe(true)
      expectClean(r.results)
    }, 180_000)
  })
})
