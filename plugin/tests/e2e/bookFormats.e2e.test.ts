/**
 * The other formats, in the running app: a Mobipocket book, a FictionBook (bare and zipped), a
 * comic archive and a fixed-layout EPUB, written for the run from `otherFormats.ts` and
 * `richBook.ts`, and removed after it. Each opens from its file like any book, shows its text or
 * pictures, and runs none of the code it carries — with the desktop's sandbox and the iPhone's.
 * A Kindle book protected by DRM says so instead of opening.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { zipSync } from 'fflate'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildCbz, buildFb2, buildMobi, OTHER_TEXT } from '../fixtures/books/otherFormats'
import { buildFixedEpub } from '../fixtures/books/richBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader formats e2e'
const IOS_SANDBOX = 'allow-same-origin allow-scripts'

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const open = async (name) => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)} + '/' + name))
    const view = leaf.view
    await until(() => view.model?.status === 'ready' || view.model?.status === 'error', 15000)
    await wait(800)
    return { leaf, view }
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    44_000
  )

interface Opened {
  error?: string
  type?: string
  status?: string
  message?: string
  renderer?: string
  sections?: number
  text?: string
  images?: number
  findings?: string[]
  sandbox?: string | null
  pwned?: string[]
  opened?: string[]
  scripts?: number
}

/** Opens a file, visits every part, clicks everything, and reports what ran. */
const visit = (name: string, sandbox: string | null) =>
  run<Opened>(`
    const origOpen = window.open
    const opened = []
    window.open = (url) => { opened.push(String(url)); return null }
    window.__abelePwned = []
    window.__abeleTest.reader.hooks.sandbox = ${JSON.stringify(sandbox)}
    try {
      const { leaf, view } = await open(${JSON.stringify(name)})
      const out = { type: view.getViewType(), status: view.model.status, message: view.model.message }
      if (view.model.status !== 'ready') { leaf.detach(); return out }
      out.renderer = view.engine.renderer.localName.replace(/-[a-z]{6}$/, '')
      out.sections = view.engine.book.sections.length
      let text = '', images = 0, scripts = 0
      for (let i = 0; i < out.sections; i++) {
        await view.engine.goTo(i)
        // The part's page is made and laid out a moment after the engine has gone there.
        await wait(1200)
        for (const { doc } of view.engine.renderer.getContents()) {
          if (!doc?.body) continue
          text += ' ' + doc.body.innerText
          images += doc.querySelectorAll('img').length
          scripts += doc.getElementsByTagName('script').length
          for (const el of doc.body.querySelectorAll('*'))
            try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView })) } catch {}
        }
        // A click at the page's left edge turns back a page: let it finish before going on.
        await wait(500)
      }
      await wait(500)
      Object.assign(out, { text, images, scripts, findings: view.pages.flatMap((p) => p.findings),
        sandbox: view.pages[0]?.sandbox ?? null, pwned: [...window.__abelePwned], opened })
      leaf.detach()
      return out
    } finally {
      window.open = origOpen
      window.__abeleTest.reader.hooks.sandbox = null
      delete window.__abelePwned
    }
  `)

describe.skipIf(!available)('books in the other formats', () => {
  beforeAll(() => {
    const fb2 = buildFb2()
    const files: Record<string, string> = {
      'book.mobi': Buffer.from(buildMobi()).toString('base64'),
      'locked.azw3': Buffer.from(buildMobi({ encrypted: true })).toString('base64'),
      'book.fb2': Buffer.from(fb2).toString('base64'),
      'book.fbz': Buffer.from(zipSync({ 'book.fb2': fb2 })).toString('base64'),
      'comic.cbz': Buffer.from(buildCbz()).toString('base64'),
      'fixed.epub': Buffer.from(buildFixedEpub()).toString('base64'),
    }
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  for (const [platform, sandbox, expected] of [
    ['the desktop', null, 'allow-same-origin'],
    ['the iPhone', IOS_SANDBOX, IOS_SANDBOX],
  ] as const) {
    describe(`with the sandbox of ${platform}`, () => {
      it('opens a Mobipocket book, shows its text, and runs nothing in it', () => {
        const r = visit('book.mobi', sandbox)
        expect(r.error).toBeUndefined()
        expect(r.type).toBe('abele-book')
        expect(r.status).toBe('ready')
        expect(r.sections).toBe(2)
        expect(r.text).toContain(OTHER_TEXT)
        expect(r.text).toContain('The second part of the book.')
        expect(r.scripts).toBe(0)
        expect(r.findings).toEqual([])
        expect(r.sandbox).toBe(expected)
        expect(r.pwned).toEqual([])
        expect(r.opened).toEqual([])
      })

      it('opens a FictionBook, bare and zipped, and runs nothing in it', () => {
        for (const name of ['book.fb2', 'book.fbz']) {
          const r = visit(name, sandbox)
          expect(r.error).toBeUndefined()
          expect(r.status).toBe('ready')
          expect(r.text).toContain(OTHER_TEXT)
          expect(r.text).toContain('The second chapter.')
          expect(r.images).toBeGreaterThan(0)
          expect(r.findings).toEqual([])
          expect(r.pwned).toEqual([])
          expect(r.opened).toEqual([])
        }
      })

      it('opens a fixed-layout book page by page, and runs nothing in it', () => {
        const r = visit('fixed.epub', sandbox)
        expect(r.error).toBeUndefined()
        expect(r.renderer).toBe('foliate-fxl')
        expect(r.sections).toBe(3)
        expect(r.text).toContain('Fixed page 3 of the picture book.')
        expect(r.scripts).toBe(0)
        expect(r.findings).toEqual([])
        expect(r.pwned).toEqual([])
      })
    })
  }

  it('opens a comic archive as its pictures, in reading order', () => {
    const r = run<{
      error?: string
      renderer?: string
      order?: string[]
      drawn?: number
      kind?: string
    }>(`
      const { leaf, view } = await open('comic.cbz')
      const renderer = view.engine.renderer.localName.replace(/-[a-z]{6}$/, '')
      const order = view.engine.book.sections.map((s) => s.id)
      await view.engine.goTo(0)
      await wait(600)
      // A comic's first page stands alone on the right of its spread; the left is blank.
      await until(() => view.engine.renderer.getContents().some((c) => c.doc?.querySelector('img')?.naturalWidth), 5000)
      const img = view.engine.renderer.getContents().map((c) => c.doc?.querySelector('img')).find(Boolean)
      const drawn = img ? img.naturalWidth : 0
      const kind = view.model.kind
      leaf.detach()
      return { renderer, order, drawn, kind }
    `)
    expect(r.error).toBeUndefined()
    expect(r.renderer).toBe('foliate-fxl')
    expect(r.order).toEqual(['page1.png', 'page2.png', 'page10.png'])
    expect(r.drawn).toBe(60)
    expect(r.kind).toBe('fixed')
  })

  it('says a protected Kindle book cannot be opened', () => {
    const r = visit('locked.azw3', null)
    expect(r.error).toBeUndefined()
    expect(r.type).toBe('abele-book')
    expect(r.status).toBe('error')
    expect(r.message).toMatch(/protected by DRM/)
  })

  it('highlights words on a fixed page, and the agent reads and searches the other formats', () => {
    const r = run<{
      error?: string
      boxes?: number
      read?: string
      search?: string
      fb2?: string
    }>(`
      const { leaf, view } = await open('fixed.epub')
      await view.engine.goTo(1)
      await wait(600)
      const doc = view.engine.renderer.getContents().map((c) => c.doc).find((d) => d.getElementById('line2'))
      const text = doc.getElementById('line2').firstChild
      const range = doc.createRange(); range.setStart(text, 0); range.setEnd(text, 10)
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      await view.reading.highlight('green')
      await until(() => doc.querySelector('.abele-marks__box'), 5000)
      const boxes = doc.querySelectorAll('.abele-marks__box').length
      leaf.detach()
      const tools = Object.fromEntries(window.__abeleTest.createBookTools().map((t) => [t.name, t]))
      const call = async (name, params) => (await tools[name].execute('t', params)).content.map((c) => c.text).join('')
      const scope = window.__abeleTest.ScopeResolver.getInstance()
      const full = scope.fullVaultAccess.value
      scope.setFullVaultAccess(true)
      try {
        return {
          boxes,
          read: await call('book_read', { book: ${JSON.stringify(DIR)} + '/book.mobi', part: 1 }),
          search: await call('book_search', { book: ${JSON.stringify(DIR)} + '/book.mobi', query: 'second part' }),
          fb2: await call('book_read', { book: ${JSON.stringify(DIR)} + '/book.fb2', part: 1 }),
        }
      } finally {
        scope.setFullVaultAccess(full)
      }
    `)
    expect(r.error).toBeUndefined()
    expect(r.boxes).toBeGreaterThan(0)
    expect(r.read).toContain(OTHER_TEXT)
    expect(r.read).not.toContain('<script')
    expect(r.search).toMatch(/^1 find of "second part"/)
    expect(r.fb2).toContain(OTHER_TEXT)
  })
})
