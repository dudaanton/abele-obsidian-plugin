/**
 * Line art in a dark theme: a book's diagrams drawn as dark lines on transparency, made for white
 * paper, vanished on a dark page — the owner's book showed its pictures on the desktop (light) and
 * none on the phone (dark). The book is `tests/fixtures/books/lineArtBook.ts`: a PNG with alpha,
 * an SVG file in an `img` and an SVG in the page. Each is pictured on screen in a dark theme and
 * must show light paper with dark lines on it. A picture goes to `/tmp/abele-dark-pictures.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildLineArtEpub } from '../fixtures/books/lineArtBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader dark pictures e2e'
const BOOK = `${DIR}/line-art.epub`
const SHOT = '/tmp/abele-dark-pictures.png'

const setTheme = (dark: boolean) => `
  document.body.classList.toggle('theme-dark', ${dark})
  document.body.classList.toggle('theme-light', ${!dark})
  app.workspace.trigger('css-change')
`

interface Picture {
  id: string
  background: string
  shown: boolean
  light?: number
  dark?: number
}

describe.skipIf(!available)('pictures in a dark theme', () => {
  beforeAll(() => {
    const data = Buffer.from(buildLineArtEpub()).toString('base64')
    evalRaw(
      `(async () => {
        window.__abeleReaderSaved = { ...window.__abeleTest.AbeleConfig.getInstance().reader }
        if (!app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(BOOK)})
        if (old) await app.vault.modifyBinary(old, bytes.buffer)
        else await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
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
        ${setTheme(false)}
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        const places = app.vault.getAbstractFileByPath('abele-book-places.json')
        if (places) await app.vault.delete(places)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('are drawn on light paper, their dark lines showing', () => {
    const r = evalAsync<{ error?: string; pictures?: Picture[] }>(
      `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const until = async (fn, ms = 15000) => {
          const deadline = Date.now() + ms
          while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
          return null
        }
        try {
          const cfg = window.__abeleTest.AbeleConfig.getInstance()
          cfg.reader = { ...cfg.reader, themeColors: true, flow: 'scrolled', columns: 1 }
          await cfg.saveSettings()
          ${setTheme(true)}
          const leaf = app.workspace.getLeaf('tab')
          await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(BOOK)}))
          const view = leaf.view
          await until(() => view.model?.status === 'ready')
          // Nothing over the page: the side panel a desktop run may have left open.
          view.model.panel = false
          await view.engine.goTo(0)
          const doc = await until(() => {
            const d = view.engine.renderer.getContents()[0]?.doc
            return d && [...d.images].every((i) => i.complete && i.naturalWidth) && d
          })
          if (!doc) return { error: 'the pictures never loaded' }
          await wait(1200)
          const frame = doc.defaultView.frameElement.getBoundingClientRect()
          const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
          if (img) require('fs').writeFileSync(${JSON.stringify(SHOT)}, img.toPNG())
          const scale = img ? img.getSize().width / window.innerWidth : 1
          const bitmap = img?.toBitmap()
          const width = img?.getSize().width ?? 0
          const pictures = []
          for (const id of ['art', 'drawing', 'inline']) {
            const el = doc.getElementById(id)
            const r = el.getBoundingClientRect()
            const box = { left: frame.left + r.left + 6, top: frame.top + r.top + 6, right: frame.left + r.right - 6, bottom: frame.top + r.bottom - 6 }
            // Shown means the reader is what is on top at every corner — the frame, or the engine
            // its shadow root retargets to: not under a bar, a panel or past the screen.
            const iframe = doc.defaultView.frameElement
            const shown = box.right > box.left && box.bottom > box.top &&
              [[box.left, box.top], [box.right, box.top], [box.left, box.bottom], [box.right, box.bottom]]
                .every(([x, y]) => [iframe, view.engine].includes(document.elementFromPoint(x, y)))
            const out = { id, background: doc.defaultView.getComputedStyle(el).backgroundColor, shown }
            if (bitmap && shown) {
              let light = 0, dark = 0, all = 0
              for (let y = Math.ceil(box.top * scale); y < box.bottom * scale; y += 2)
                for (let x = Math.ceil(box.left * scale); x < box.right * scale; x += 2) {
                  const at = (y * width + x) * 4
                  const lum = Math.max(bitmap[at], bitmap[at + 1], bitmap[at + 2])
                  if (lum > 200) light++
                  else if (lum < 80) dark++
                  all++
                }
              out.light = light / all
              out.dark = dark / all
            }
            pictures.push(out)
          }
          leaf.detach()
          return { pictures }
        } catch (e) { return { error: String((e && e.stack) || e) } }
      })()`,
      120_000
    )
    expect(r.error).toBeUndefined()
    const pictures = r.pictures ?? []
    expect(pictures.map((p) => p.id)).toEqual(['art', 'drawing', 'inline'])
    for (const p of pictures) expect(p.background, p.id).toBe('rgb(255, 255, 255)')
    // At least one is on screen to be looked at; each that is shows paper and ink.
    expect(pictures.some((p) => p.shown)).toBe(true)
    for (const p of pictures.filter((p) => p.light !== undefined)) {
      expect(p.light, p.id).toBeGreaterThan(0.5)
      expect(p.dark, p.id).toBeGreaterThan(0.01)
    }
  }, 150_000)
})
