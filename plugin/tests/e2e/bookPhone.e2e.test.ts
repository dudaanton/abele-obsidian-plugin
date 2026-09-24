/**
 * A book on a phone: `app.emulateMobile(true)` in a 390×844 window, a plain book and the
 * author's test book opened in turn. Each is asked whether its page reaches past the screen,
 * whether the page shows text at all, and whether a tap on the right edge turns the page.
 * A picture of each goes to `/tmp/abele-phone/book-*.png` — look at them.
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
  text?: number
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
      await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)} + '/' + ${JSON.stringify(name)} + '.epub'))
      await app.workspace.revealLeaf(leaf)
      const view = leaf.view
      if (!await until(() => view.engine?.lastLocation)) return { ...report, error: 'the book never showed' }
      await wait(1000)
      const engine = view.engine
      const r = engine.getBoundingClientRect()
      report.over = Math.max(0, Math.round(r.right - window.innerWidth))
      // The page keeps clear of Obsidian's floating header and navigation bar.
      const bar = document.querySelector('.mobile-navbar')?.getBoundingClientRect()
      report.underBar = bar && bar.height ? Math.max(0, Math.round(r.bottom - bar.top)) : 0
      const header = leaf.view.containerEl.querySelector('.view-header')?.getBoundingClientRect()
      report.underHeader = header ? Math.max(0, Math.round(header.bottom - r.top)) : 0
      const page = engine.renderer.getContents()[0]
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
    } catch (e) {
      report.error = String((e && e.stack) || e)
    }
    return report
  })()`)

describe.skipIf(!available)('a book on a phone', () => {
  let size: [number, number] = [0, 0]
  const screens: Record<string, Screen> = {}

  beforeAll(async () => {
    const books = {
      plain: Buffer.from(buildPlainEpub(6)).toString('base64'),
      'epub-test': readFileSync(join(__dirname, '../fixtures/books/epub-test.epub')).toString(
        'base64'
      ),
    }
    evalRaw(
      `(async () => {
        if (!app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(books)})) {
          const path = ${JSON.stringify(DIR)} + '/' + name + '.epub'
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

  it.each(['plain', 'epub-test'])('%s: shown in the phone layout, inside the screen', (name) => {
    expect(screens[name]?.error).toBeUndefined()
    expect(screens[name]?.phone).toBe(true)
    expect(screens[name]?.over).toBe(0)
    expect(screens[name]?.underBar).toBe(0)
    expect(screens[name]?.underHeader).toBe(0)
    expect(screens[name]?.text).toBeGreaterThan(20)
  })

  it('the plain book turns its page on a tap at the right edge', () => {
    expect(screens.plain?.turned).toBe(true)
  })
})
