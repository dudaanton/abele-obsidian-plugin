/**
 * PDFs in the book reader, in the running app, drawn by Obsidian's own PDF.js.
 *
 * Two PDFs are written to the vault for the run (`tests/fixtures/books/pdfFixture.ts`) and removed
 * after it: a plain one — five pages, an outline, a link to page four, a link to the web — and a
 * hostile one carrying JavaScript on opening, behind a link, in a form field and in the document's
 * names, a `javascript:` address, a launch action and a `file:` address. The hostile one is opened
 * with the desktop's sandbox and with the iPhone's, every link on it clicked, and nothing may run,
 * open or be asked of Node.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildHostilePdf, buildPlainPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader pdf e2e'
const PLAIN = `${DIR}/plain.pdf`
const HOSTILE = `${DIR}/hostile.pdf`
const IOS_SANDBOX = 'allow-same-origin allow-scripts'

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  /** Opens a PDF in the reader, the way "Open in Abele reader" does. */
  const open = async (path) => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready' || view.model?.status === 'error', 15000)
    return { leaf, view }
  }
  const pageDocs = (view) => view.engine.renderer.getContents().map((c) => c.doc).filter(Boolean)
  const drawn = (view) => until(() => pageDocs(view).find((d) => d.querySelector('#canvas img') && d.querySelector('.textLayer span')), 10000)
`

const run = <T>(body: string, timeout = 120_000): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    timeout
  )

describe.skipIf(!available)('a PDF in the reader', () => {
  beforeAll(() => {
    const files = {
      'plain.pdf': Buffer.from(buildPlainPdf()).toString('base64'),
      'hostile.pdf': Buffer.from(buildHostilePdf()).toString('base64'),
    }
    evalRaw(
      `(async () => {
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        window.__abeleReaderSaved = { ...cfg.reader }
        // Pages turned one at a time: the continuous scroll has a file of its own.
        cfg.reader = { ...cfg.reader, pdfLayout: 'paginated' }
        await cfg.saveSettings()
        if (!app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const path = ${JSON.stringify(DIR)} + '/' + name
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          const old = app.vault.getAbstractFileByPath(path)
          if (old) await app.vault.modifyBinary(old, bytes.buffer)
          else await app.vault.createBinary(path, bytes.buffer)
        }
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
        if (window.__abeleReaderSaved) { cfg.reader = window.__abeleReaderSaved; await cfg.saveSettings() }
        delete window.__abeleReaderSaved
        window.__abeleTest.reader.hooks.sandbox = null
        document.body.classList.toggle('theme-dark', false)
        document.body.classList.toggle('theme-light', true)
        app.workspace.trigger('css-change')
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('draws each page with its text selectable, and lists the outline as the contents', () => {
    const r = run<{
      error?: string
      status?: string
      message?: string
      pages?: number
      text?: string
      canvas?: number
      findings?: string[]
      sandbox?: string | null
      toc?: string[]
      icon?: string
      chapter?: string
    }>(`
      const { leaf, view } = await open(${JSON.stringify(PLAIN)})
      const out = { status: view.model.status, message: view.model.message }
      // From the first page, wherever an earlier run left the document.
      await view.engine.goTo(0)
      const doc = await until(() => pageDocs(view).find((d) => d.querySelector('#canvas img') && d.querySelector('.textLayer')?.textContent.includes('Page 1')), 10000)
      out.pages = view.engine.book.sections.length
      out.text = doc?.querySelector('.textLayer')?.textContent ?? ''
      out.canvas = doc?.querySelector('#canvas img')?.getBoundingClientRect().width ?? 0
      out.findings = view.pages.flatMap((p) => p.findings)
      out.sandbox = view.pages[0]?.sandbox ?? null
      const flat = (list) => list.flatMap((e) => [e.label, ...flat(e.children)])
      out.toc = flat(view.model.toc)
      out.icon = view.getIcon()
      out.chapter = view.model.chapter
      leaf.detach()
      return out
    `)
    expect(r.error).toBeUndefined()
    expect(r.status).toBe('ready')
    expect(r.pages).toBe(5)
    expect(r.text).toContain('Page 1 of the test document')
    expect(r.canvas).toBeGreaterThan(100)
    expect(r.findings).toEqual([])
    expect(r.sandbox).toBe('allow-same-origin')
    expect(r.toc).toEqual(['Part one', 'Page two', 'Part two'])
    expect(r.icon).toBe('file-text')
    expect(r.chapter).toBe('Page 1 of 5 · Part one')
  })

  it('turns pages, follows its links, goes to an outline entry and keeps the page it was left on', () => {
    // In steps, each well within one call's allowance, the tab kept on the window between them.
    const keys = run<{ error?: string; afterKey?: number }>(`
      const { leaf, view } = await open(${JSON.stringify(PLAIN)})
      window.__abelePdfLeaf = leaf
      await drawn(view)
      await view.engine.goTo(0)
      await wait(500)
      pageDocs(view)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await until(() => view.engine.renderer.index === 1, 5000)
      return { afterKey: view.engine.renderer.index }
    `)
    expect(keys.error).toBeUndefined()
    expect(keys.afterKey).toBe(1)

    const links = run<{ error?: string; afterLink?: number; opened?: string[] }>(`
      const view = window.__abelePdfLeaf.view
      const origOpen = window.open
      const opened = []
      window.open = (url) => { opened.push(String(url)); return null }
      try {
        await view.engine.goTo(0)
        const doc = await until(() => pageDocs(view).find((d) => d.querySelectorAll('.annotationLayer a').length >= 2), 10000)
        const anchors = [...doc.querySelectorAll('.annotationLayer a')]
        anchors.find((a) => (a.getAttribute('href') ?? '').startsWith('http'))?.click()
        await wait(300)
        anchors.find((a) => (a.getAttribute('href') ?? '').startsWith('['))?.click()
        await until(() => view.engine.renderer.index === 3, 5000)
        return { afterLink: view.engine.renderer.index, opened }
      } finally {
        window.open = origOpen
      }
    `)
    expect(links.error).toBeUndefined()
    expect(links.afterLink).toBe(3)
    expect(links.opened).toEqual(['https://example.com/'])

    const place = run<{ error?: string; afterToc?: number; reopened?: number }>(`
      let view = window.__abelePdfLeaf.view
      await view.engine.goTo(view.model.toc[0].children[0].href)
      await until(() => view.engine.renderer.index === 1, 5000)
      const partTwo = view.model.toc.find((e) => e.label === 'Part two')
      await view.engine.goTo(partTwo.href)
      await until(() => view.engine.renderer.index === 3, 5000)
      const afterToc = view.engine.renderer.index
      await view.engine.goTo(2)
      await wait(800)
      window.__abelePdfLeaf.detach()
      delete window.__abelePdfLeaf
      await wait(300)
      const again = await open(${JSON.stringify(PLAIN)})
      await wait(800)
      const reopened = again.view.engine.renderer.index
      again.leaf.detach()
      return { afterToc, reopened }
    `)
    expect(place.error).toBeUndefined()
    expect(place.afterToc).toBe(3)
    expect(place.reopened).toBe(2)
  })

  it('sizes pages as set, darkens them in a dark theme, and shows only its own settings', () => {
    const r = run<{
      error?: string
      zoom?: string | null
      dark?: boolean
      light?: boolean
      filter?: string
      rows?: string[]
    }>(`
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      const { leaf, view } = await open(${JSON.stringify(PLAIN)})
      await drawn(view)
      cfg.reader = { ...cfg.reader, pdfZoom: 'fit-width', pdfDarkPages: true }
      await cfg.saveSettings()
      await wait(600)
      const zoom = view.engine.renderer.getAttribute('zoom')
      document.body.classList.toggle('theme-light', false)
      document.body.classList.toggle('theme-dark', true)
      app.workspace.trigger('css-change')
      await wait(600)
      const dark = view.engine.classList.contains('abele-book__engine_dark-pages')
      const frame = pageDocs(view)[0].defaultView.frameElement
      const filter = getComputedStyle(frame).filter
      document.body.classList.toggle('theme-dark', false)
      document.body.classList.toggle('theme-light', true)
      app.workspace.trigger('css-change')
      await wait(600)
      const light = view.engine.classList.contains('abele-book__engine_dark-pages')
      view.model.settingsOpen = true
      await wait(600)
      const rows = [...document.querySelectorAll('.modal .abele-reader-settings .setting-item-name')].map((n) => n.textContent.trim())
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      cfg.reader = { ...window.__abeleReaderSaved, pdfLayout: 'paginated' }
      await cfg.saveSettings()
      leaf.detach()
      return { zoom, dark, light, filter, rows }
    `)
    expect(r.error).toBeUndefined()
    expect(r.zoom).toBe('fit-width')
    expect(r.dark).toBe(true)
    expect(r.filter).toContain('invert')
    expect(r.light).toBe(false)
    expect(r.rows).toEqual([
      'Layout',
      'Page size',
      'Two pages side by side',
      'Dark pages in a dark theme',
    ])
  })

  it('opens PDFs here instead of in Obsidian’s viewer only while the setting is on, and offers Open in Abele reader', () => {
    const r = run<{
      error?: string
      before?: string
      on?: string
      openedIn?: string
      after?: string
      menu?: string[]
    }>(`
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      const before = app.viewRegistry.typeByExtension.pdf
      cfg.reader = { ...cfg.reader, openPdf: true }
      await cfg.saveSettings()
      await wait(300)
      const on = app.viewRegistry.typeByExtension.pdf
      const leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(PLAIN)}))
      await wait(500)
      const openedIn = leaf.view.getViewType()
      leaf.detach()
      cfg.reader = { ...cfg.reader, openPdf: false }
      await cfg.saveSettings()
      await wait(300)
      const after = app.viewRegistry.typeByExtension.pdf
      // A stand-in for the menu: what matters is which items the plugin adds to it.
      const items = []
      const menu = { addItem(add) {
        const item = { setTitle(t) { items.push(t); return item }, setIcon() { return item },
          setSection() { return item }, onClick() { return item } }
        add(item)
        return menu
      } }
      app.workspace.trigger('file-menu', menu, app.vault.getAbstractFileByPath(${JSON.stringify(PLAIN)}), 'file-explorer')
      return { before, on, openedIn, after, menu: items }
    `)
    expect(r.error).toBeUndefined()
    expect(r.before).toBe('pdf')
    expect(r.on).toBe('abele-book')
    expect(r.openedIn).toBe('abele-book')
    expect(r.after).toBe('pdf')
    expect(r.menu).toContain('Open in Abele reader')
  })

  for (const [platform, sandbox] of [
    ['the desktop', null],
    ['the iPhone', IOS_SANDBOX],
  ] as const) {
    it(`runs nothing a hostile PDF carries, with the sandbox of ${platform}`, () => {
      const r = run<{
        error?: string
        status?: string
        pwned?: string[]
        alerts?: string[]
        opened?: string[]
        required?: string[]
        hrefs?: string[]
        findings?: string[]
        links?: number
        text?: string
      }>(`
        const origOpen = window.open, origAlert = window.alert, origRequire = window.require
        const opened = [], alerts = [], required = []
        window.open = (url) => { opened.push(String(url)); return null }
        window.alert = (m) => { alerts.push(String(m)) }
        window.require = (m) => {
          if (m === 'child_process') { required.push(m); return { execSync() {}, exec() {}, spawn() {} } }
          return origRequire(m)
        }
        window.__abelePwned = []
        window.__abeleTest.reader.hooks.sandbox = ${JSON.stringify(sandbox)}
        try {
          const { leaf, view } = await open(${JSON.stringify(HOSTILE)})
          const status = view.model.status
          // The hostile links are on page one, wherever an earlier run left the document.
          await view.engine.goTo(0)
          const doc = await until(() => pageDocs(view).find((d) => d.querySelector('#canvas img') && d.querySelector('.textLayer')?.textContent.includes('Page 1')), 10000)
          await wait(1500)
          const links = [...(doc?.querySelectorAll('.annotationLayer a, .annotationLayer section, .annotationLayer input') ?? [])]
          for (const el of links) {
            try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView })) } catch {}
            try { el.dispatchEvent(new FocusEvent('focus')) } catch {}
          }
          const text = doc?.querySelector('.textLayer')?.textContent ?? ''
          await view.engine.next()
          await wait(1000)
          const hrefs = [...(doc?.querySelectorAll('[href]') ?? [])].map((a) => a.getAttribute('href'))
          const out = { status, text, pwned: [...window.__abelePwned], alerts, opened, required, hrefs, links: links.length,
            findings: view.pages.flatMap((p) => p.findings) }
          leaf.detach()
          return out
        } finally {
          window.open = origOpen
          window.alert = origAlert
          window.require = origRequire
          window.__abeleTest.reader.hooks.sandbox = null
          delete window.__abelePwned
        }
      `)
      expect(r.error).toBeUndefined()
      expect(r.status).toBe('ready')
      // The page drew; what it drew of the hostile links is whatever PDF.js thought safe — the
      // `javascript:`, `file:` and launch links not at all, the script one without its script.
      expect(r.text).toContain('Page 1 of the test document')
      expect(r.pwned).toEqual([])
      expect(r.alerts).toEqual([])
      expect(r.opened).toEqual([])
      expect(r.required).toEqual([])
      expect(r.findings).toEqual([])
      // No address that could run, reach a file or leave the reader was given to any link.
      for (const href of r.hrefs ?? []) expect(href).not.toMatch(/^(javascript|file|vbscript):/i)
    })
  }
})
