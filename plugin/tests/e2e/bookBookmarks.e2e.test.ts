/**
 * Bookmarks in the running app: the bookmark under the page marks the page and fills, the
 * Bookmarks tab of the side panel lists it and goes back to it, a bigger text size keeps it on the
 * words it was made on, the file in the vault holds it, another device's removal arriving in that
 * file takes it away, a PDF page is marked with its words, and the agent sees them.
 *
 * Then on a phone (390×844 under `emulateMobile`): the bar with the bookmark and the list in the
 * drawer, measured and photographed to `/tmp/abele-phone/bookmarks-*.png` — look at them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, runCli } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub, RICH_BOOK_ID } from '../fixtures/books/richBook'
import { buildLongPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader bookmarks e2e'
const BOOK = `${DIR}/rich.epub`
const PDF = `${DIR}/long.pdf`
const SHOTS = '/tmp/abele-phone'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const cfg = window.__abeleTest.AbeleConfig.getInstance()
  const placesFile = cfg.reader?.placesPath || 'abele-book-places.json'
  const marksFile = placesFile.includes('/') ? placesFile.slice(0, placesFile.lastIndexOf('/')) + '/abele-book-bookmarks.json' : 'abele-book-bookmarks.json'
  const savedMarks = async () => (await app.vault.adapter.exists(marksFile)) ? JSON.parse(await app.vault.adapter.read(marksFile)) : {}
  const tools = Object.fromEntries(window.__abeleTest.createBookTools().map((t) => [t.name, t]))
  const call = async (name, params = {}) => (await tools[name].execute('t', params)).content.map((c) => c.text).join('')
  const open = async (path) => {
    for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready', 15000)
    await wait(800)
    return { leaf, view }
  }
  const button = (view) => view.contentEl.querySelector('.abele-book-reader__bookmark')
  const press = async (view) => { button(view).click(); await wait(600) }
  const filled = (view) => button(view)?.classList.contains('abele-obsidian-icon_active') ?? null
  const shoot = async (name) => {
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/bookmarks-' + name + '.png', img.toPNG()) }
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

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
  runCli(['dev:debug', 'on'], 30_000)
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`
  )
}

describe.skipIf(!available)('bookmarks in the reader', () => {
  let savedReader: unknown = null

  beforeAll(() => {
    const files = {
      'rich.epub': Buffer.from(buildRichEpub()).toString('base64'),
      'long.pdf': Buffer.from(buildLongPdf(12)).toString('base64'),
    }
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
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
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, flow: 'paginated', fontSize: 100 }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
  }, 120_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        // The fixture vault holds nothing of the tests' own afterwards.
        await new Promise((r) => setTimeout(r, 1500))
        for (const f of ['abele-book-places.json', 'abele-book-bookmarks.json'])
          if (await app.vault.adapter.exists(f)) await app.vault.adapter.remove(f)
        return 'ok'
      })()`,
      60_000
    )
  }, 60_000)

  it('marks a page, lists it, goes back to it, keeps it through a bigger text, and a removal from another device takes it away', () => {
    const r = run<{
      error?: string
      before?: boolean | null
      after?: boolean | null
      turned?: boolean | null
      rows?: { label: string; text: string; active: boolean }[]
      back?: boolean | null
      bigger?: boolean | null
      file?: { cfi: string; label: string }[]
      views?: string
      gone?: number
      unfilled?: boolean | null
    }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      const key = 'id:' + ${JSON.stringify(RICH_BOOK_ID)}
      for (const b of view.model.bookmarks) await view.bookmarks.remove(b)
      await wait(300)
      await view.engine.goTo(view.model.toc[2].href); await wait(700)
      const before = filled(view)
      await press(view)
      const after = filled(view)
      await view.engine.renderer.next(); await wait(700)
      const turned = filled(view)
      view.model.panelTab = 'bookmarks'; view.model.panel = true; await wait(400)
      const rows = [...view.contentEl.querySelectorAll('.abele-book-bookmarks__item')].map((el) => ({
        label: el.querySelector('.abele-book-bookmarks__label')?.textContent ?? '',
        text: el.querySelector('.abele-book-bookmarks__text')?.textContent ?? '',
        active: el.classList.contains('is-active'),
      }))
      view.contentEl.querySelector('.abele-book-bookmarks__item').click(); await wait(900)
      const back = filled(view)
      cfg.reader = { ...cfg.reader, fontSize: 150 }; cfg.version.value++; await wait(1500)
      await view.bookmarks.go(view.model.bookmarks[0]); await wait(900)
      const bigger = filled(view)
      await wait(1200)
      const file = Object.values((await savedMarks())[key] ?? {}).filter((b) => !b.deleted)
      // The tools answer to the chat's scope; for the call it reaches the whole vault.
      const scope = window.__abeleTest.ScopeResolver.getInstance()
      const full = scope.fullVaultAccess.value
      scope.setFullVaultAccess(true)
      const views = await call('book_views').finally(() => scope.setFullVaultAccess(full))
      // Removed on another device: its copy arrives on disk, as a sync writes it.
      const all = await savedMarks()
      for (const b of Object.values(all[key])) { b.deleted = true; b.at = Date.now() + 1000 }
      require('fs').writeFileSync(require('path').join(app.vault.adapter.getBasePath(), marksFile), JSON.stringify(all))
      await until(() => view.model.bookmarks.length === 0, 10000)
      const gone = view.model.bookmarks.length
      const unfilled = filled(view)
      cfg.reader = { ...cfg.reader, fontSize: 100 }; cfg.version.value++; await wait(800)
      leaf.detach()
      return { before, after, turned, rows, back, bigger, file, views, gone, unfilled }
    `)
    expect(r.error).toBeUndefined()
    expect([r.before, r.after, r.turned]).toEqual([false, true, false])
    expect(r.rows).toHaveLength(1)
    expect(r.rows![0].label).toMatch(/^Chapter 3/)
    expect(r.rows![0].text.length).toBeGreaterThan(10)
    expect(r.rows![0].active).toBe(false)
    expect(r.back).toBe(true)
    expect(r.bigger).toBe(true)
    expect(r.file).toHaveLength(1)
    expect(r.file![0].cfi).toMatch(/^epubcfi\(\/6\/6!/)
    expect(r.views).toMatch(
      /Bookmarks: 1\n {3}- \[\[rich\.epub#cfi=.*\|Chapter 3.*\]\] \(this page\)/
    )
    expect(r.gone).toBe(0)
    expect(r.unfilled).toBe(false)
  })

  it('marks a PDF page with its words, and knows it again', () => {
    const r = run<{
      error?: string
      label?: string
      text?: string
      there?: boolean | null
      elsewhere?: boolean | null
      again?: boolean | null
    }>(`
      const { leaf, view } = await open(${JSON.stringify(PDF)})
      for (const b of view.model.bookmarks) await view.bookmarks.remove(b)
      await view.engine.goTo(4); await wait(1200)
      await press(view)
      await until(() => view.model.bookmarks.length === 1, 5000)
      const [b] = view.model.bookmarks
      const there = filled(view)
      await view.engine.goTo(8); await wait(1200)
      const elsewhere = filled(view)
      await view.bookmarks.go(b); await wait(1200)
      const again = filled(view)
      await press(view)
      leaf.detach()
      return { label: b.label, text: b.text, there, elsewhere, again }
    `)
    expect(r.error).toBeUndefined()
    expect(r.label).toMatch(/^Page 5 of 12/)
    expect(r.text).toMatch(/\w+/)
    expect([r.there, r.elsewhere, r.again]).toEqual([true, false, true])
  })

  describe('on a phone', () => {
    let size: [number, number] = [0, 0]

    beforeAll(async () => {
      size = evalJson<[number, number]>(
        `require('@electron/remote').getCurrentWindow().getContentSize()`
      )
      await reload('app.emulateMobile(true)')
      await setWindowSize(390, 844)
      await reload('window.location.reload()')
    }, 240_000)

    afterAll(async () => {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reload('app.emulateMobile(false)')
    }, 180_000)

    it('the bookmark sits in the line under the page, and the list fits the drawer', () => {
      const r = run<{
        error?: string
        phone?: boolean
        button?: { left: number; right: number; top: number; bottom: number }
        screen?: { width: number; height: number }
        tabs?: {
          right: number
          left: number
          label: string
          rows: number
          strip: { left: number; right: number }
        }
        drawer?: { left: number; right: number }
        rows?: { left: number; right: number }[]
      }>(`
        const { leaf, view } = await open(${JSON.stringify(BOOK)})
        for (const b of view.model.bookmarks) await view.bookmarks.remove(b)
        await view.engine.goTo(view.model.toc[1].href); await wait(700)
        await press(view)
        await view.engine.goTo(view.model.toc[2].href); await wait(700)
        await press(view)
        await shoot('button')
        const rect = (el) => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) } }
        const button = rect(view.contentEl.querySelector('.abele-book-reader__bookmark'))
        view.model.panelTab = 'bookmarks'; view.model.panel = true; await wait(700)
        await shoot('list')
        const drawer = rect(view.contentEl.querySelector('.abele-book-reader__panel'))
        const tabEls = [...view.contentEl.querySelectorAll('.abele-book-reader__panel-head .abele-tabs__tab')]
        const active = view.contentEl.querySelector('.abele-book-reader__panel-head .abele-tabs__tab_active')
        const s = active.parentElement
        const strip = { ...rect(s), sw: s.scrollWidth, cw: s.clientWidth, sl: s.scrollLeft, head: rect(s.parentElement), css: getComputedStyle(s).overflowX + ' ' + getComputedStyle(s).flex }
        const tabs = { right: rect(active).right, left: rect(active).left, label: active.textContent.trim(), rows: new Set(tabEls.map((t) => rect(t).top)).size, strip }
        const rows = [...view.contentEl.querySelectorAll('.abele-book-bookmarks__item')].map(rect)
        view.model.panel = false; await wait(300)
        for (const b of view.model.bookmarks) await view.bookmarks.remove(b)
        await wait(1000)
        leaf.detach()
        return { phone: document.body.classList.contains('is-phone'), button, screen: { width: innerWidth, height: innerHeight }, tabs, drawer, rows }
      `)
      expect(r.error).toBeUndefined()
      expect(r.phone).toBe(true)
      expect(r.button!.left).toBeGreaterThanOrEqual(0)
      expect(r.button!.right).toBeLessThanOrEqual(r.screen!.width)
      expect(r.button!.bottom).toBeLessThanOrEqual(r.screen!.height)
      // The strip scrolls sideways on a phone; the tab showing is in view.
      expect(r.tabs!.label).toBe('Bookmarks')
      expect(r.tabs!.rows).toBe(1)
      expect(r.tabs!.left).toBeGreaterThanOrEqual(r.tabs!.strip.left)
      expect(r.tabs!.right).toBeLessThanOrEqual(r.tabs!.strip.right)
      expect(r.rows).toHaveLength(2)
      for (const row of r.rows!) {
        expect(row.left).toBeGreaterThanOrEqual(r.drawer!.left)
        expect(row.right).toBeLessThanOrEqual(r.drawer!.right)
      }
    })
  })
})
