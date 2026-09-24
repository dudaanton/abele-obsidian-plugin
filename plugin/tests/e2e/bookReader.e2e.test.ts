/**
 * Books in the running app: nothing a book carries may ever run.
 *
 * Two books are written to the vault for the run and removed after it:
 *
 * - the crafted book of `tests/fixtures/books/maliciousBook.ts`, where every page tries to run
 *   code in every way we know of and each attempt records itself on the app's window if it runs;
 * - the author's own test book (github.com/johnfactotum/epub-test, CC0), whose handlers try to
 *   open windows, fetch files and start processes through Node.
 *
 * Each is opened, every chapter is visited, and every element that could act on a click is
 * clicked. Then scripts are put into a page that is already showing, the way a gap in the
 * cleaning would leave one, to prove the page's policy stops them on its own. The whole run is
 * made twice: with the sandbox the desktop gets, and with the one the iPhone gets (which has to
 * allow scripts for WebKit to deliver events), so the second run shows the cleaning and the
 * policy holding with no help from the sandbox.
 *
 * What cannot be done here: run WebKit. The iPhone's engine is only imitated by its sandbox.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import {
  AUTO_VECTORS,
  CLICK_VECTORS,
  buildMaliciousEpub,
  buildPlainEpub,
  payload,
} from '../fixtures/books/maliciousBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader e2e'
const IOS_SANDBOX = 'allow-same-origin allow-scripts'

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try { const v = fn(); if (v) return v } catch {}
      await wait(100)
    }
    return null
  }
  const api = window.__abeleTest.reader
  // The first element of a page's head that came from the page: the engine prepends a bare style.
  const ownFirst = (doc) => {
    let el = doc.head?.firstElementChild
    while (el && el.localName === 'style' && !el.attributes.length) el = el.nextElementSibling
    return el
  }
  const payload = (id) => ${JSON.stringify(payload('ID'))}.split('ID').join(id)
`

interface Visit {
  error?: string
  sections?: number
  pages?: { index: number; findings: string[]; sandbox: string | null }[]
  frames?: {
    index: number
    protocol: string
    scripts: number
    policyFirst: boolean
    title: string
  }[]
  late?: string[]
  pwned?: string[]
  messages?: string[]
  opened?: string[]
  required?: string[]
}

/** Opens a book, visits every chapter, clicks everything, injects late scripts; reports. */
const visit = (path: string, sandbox: string | null, clickAll: boolean): Visit =>
  evalAsync<Visit>(
    `(async () => {
    ${PRELUDE}
    const report = {}
    const origOpen = window.open
    const origRequire = window.require
    try {
      window.__abelePwned = []
      window.__abeleMessages = []
      const onMessage = (e) => { if (String(e.data).startsWith('abele-pwned:')) window.__abeleMessages.push(String(e.data)) }
      window.addEventListener('message', onMessage)
      report.opened = []
      window.open = (url) => { report.opened.push(String(url)); return null }
      report.required = []
      window.require = (m) => {
        if (m === 'child_process') { report.required.push(m); return { execSync() { report.required.push('execSync') }, exec() { report.required.push('exec') } } }
        return origRequire(m)
      }

      api.hooks.sandbox = ${JSON.stringify(sandbox)}
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)})
      const leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(file)
      const view = leaf.view
      if (view.getViewType() !== api.viewType) return { error: 'opened in ' + view.getViewType() }
      if (!await until(() => view.engine && view.pages.length > 0)) return { error: 'the book never showed a page' }
      const sections = view.engine.book.sections.length
      report.sections = sections
      report.frames = []
      report.late = []
      for (let i = 0; i < sections; i++) {
        await view.engine.goTo(i)
        const page = await until(() => view.engine.renderer.getContents().find((c) => c.index === i && c.doc?.readyState === 'complete'))
        if (!page) { report.frames.push({ index: i, protocol: 'never loaded' }); continue }
        const doc = page.doc
        await wait(300)
        const targets = ${clickAll} ? [...doc.body?.querySelectorAll('*') ?? []] : [...doc.querySelectorAll('[data-vector]')]
        for (const el of targets) {
          try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView })) } catch {}
          try { if (el.localName === 'button' || el.localName === 'input') el.click() } catch {}
          try { el.dispatchEvent(new FocusEvent('focus')) } catch {}
        }
        await wait(500)
        // The page as it stands now: still the book's own blob, no scripts, the policy first.
        const view_ = doc.defaultView
        report.frames.push({
          index: i,
          protocol: (() => { try { return view_.location.protocol } catch (e) { return 'unreachable' } })(),
          scripts: doc.getElementsByTagName('script').length,
          policyFirst: doc.documentElement.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
            !!ownFirst(doc)?.hasAttribute('data-abele-csp'),
          title: doc.title || doc.documentElement.localName,
        })
        // A script that got past the cleaning: the page's policy alone has to stop it.
        if (ownFirst(doc)?.hasAttribute('data-abele-csp')) {
          const s = doc.createElement('script')
          s.textContent = payload('late-script-' + i)
          doc.body.appendChild(s)
          const img = doc.createElement('img')
          img.setAttribute('onerror', payload('late-onerror-' + i))
          img.setAttribute('src', 'missing-late.png')
          doc.body.appendChild(img)
          try { view_.eval(payload('late-eval-' + i)); report.late.push('eval ran') } catch { report.late.push('eval refused') }
          try { new view_.Function(payload('late-function-' + i))(); report.late.push('Function ran') } catch { report.late.push('Function refused') }
          await wait(500)
          s.remove(); img.remove()
        }
      }
      report.pages = view.pages.map((p) => ({ index: p.index, findings: p.findings, sandbox: p.sandbox }))
      await wait(500)
      report.pwned = [...(window.__abelePwned ?? [])]
      report.messages = [...window.__abeleMessages]
      window.removeEventListener('message', onMessage)
      leaf.detach()
    } catch (e) {
      report.error = String((e && e.stack) || e)
    } finally {
      window.open = origOpen
      window.require = origRequire
      api.hooks.sandbox = null
      delete window.__abelePwned
      delete window.__abeleMessages
    }
    return report
  })()`,
    180_000
  )

describe.skipIf(!available)('a book in the reader', () => {
  beforeAll(() => {
    const books = {
      'malicious.epub': b64(buildMaliciousEpub()),
      'plain.epub': b64(buildPlainEpub()),
      'epub-test.epub': b64(readFileSync(join(__dirname, '../fixtures/books/epub-test.epub'))),
    }
    evalRaw(
      `(async () => {
        if (!app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) await app.vault.createFolder(${JSON.stringify(DIR)})
        const books = ${JSON.stringify(books)}
        for (const [name, data] of Object.entries(books)) {
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
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  for (const [platform, sandbox, expected] of [
    ['the desktop', null, 'allow-same-origin'],
    ['the iPhone', IOS_SANDBOX, IOS_SANDBOX],
  ] as const) {
    describe(`with the sandbox of ${platform}`, () => {
      it('runs nothing from the crafted book, on load, on click, or put in afterwards', () => {
        const r = visit(`${DIR}/malicious.epub`, sandbox, false)
        expect(r.error).toBeUndefined()
        expect(r.sections).toBe(4)
        expect(r.pwned).toEqual([])
        expect(r.messages).toEqual([])
        expect(r.required).toEqual([])
        // Every chapter drew, and stayed the page the reader made of it.
        expect(r.frames!.map((f) => f.protocol)).toEqual(['blob:', 'blob:', 'blob:', 'blob:'])
        for (const f of r.frames!) {
          expect(f.scripts).toBe(0)
          expect(f.policyFirst).toBe(true)
        }
        // Every page passed its audit, in the sandbox this platform gets.
        expect(r.pages!.length).toBeGreaterThanOrEqual(4)
        for (const p of r.pages!) {
          expect(p.findings).toEqual([])
          expect(p.sandbox).toBe(expected)
        }
        // The policy refuses code handed to the page from outside, too.
        expect(r.late!.filter((l) => l.endsWith('ran'))).toEqual([])
        expect(r.late!.length).toBeGreaterThan(0)
        // Nothing asked the app to open anything.
        expect(r.opened).toEqual([])
        // The vectors the book carries are the ones this file checks.
        expect(AUTO_VECTORS.length + CLICK_VECTORS.length).toBeGreaterThan(30)
      })

      it("runs nothing from the author's test book, and opens only its web link", () => {
        const r = visit(`${DIR}/epub-test.epub`, sandbox, true)
        expect(r.error).toBeUndefined()
        expect(r.pwned).toEqual([])
        expect(r.required).toEqual([])
        expect(r.frames![0].protocol).toBe('blob:')
        expect(r.frames![0].scripts).toBe(0)
        expect(r.pages![0].findings).toEqual([])
        // The one external link in the book, handed to the system browser; no data: or javascript:.
        expect(r.opened).toEqual(['https://example.com'])
        expect(r.late!.filter((l) => l.endsWith('ran'))).toEqual([])
      })
    })
  }

  it('opens a plain book on its first chapter and turns pages with the arrow keys', () => {
    const r = evalAsync<{ error?: string; before?: number; after?: number; title?: string }>(
      `(async () => {
        ${PRELUDE}
        const leaf = app.workspace.getLeaf('tab')
        try {
          await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/plain.epub`)}))
          const view = leaf.view
          await until(() => view.engine?.lastLocation)
          // The first chapter settles over a few relocations; take the page it rests on.
          await wait(1500)
          const before = view.engine.lastLocation.fraction
          const doc = view.engine.renderer.getContents()[0].doc
          doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
          await until(() => view.engine.lastLocation.fraction > before, 5000)
          return { before, after: view.engine.lastLocation.fraction, title: view.getDisplayText() }
        } catch (e) {
          return { error: String(e) }
        } finally {
          leaf.detach()
        }
      })()`,
      60_000
    )
    expect(r.error).toBeUndefined()
    expect(r.title).toBe('plain')
    expect(r.after!).toBeGreaterThan(r.before!)
  })
})
