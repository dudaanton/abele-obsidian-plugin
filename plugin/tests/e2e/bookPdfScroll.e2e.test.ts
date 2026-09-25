/**
 * A PDF as one continuous scroll, in the running app: pages under each other, only those near the
 * screen drawn, the page being read reported as the scroll moves, links and the place kept, zoom
 * by keys and pinch, and the switch back to pages. The PDF is `buildLongPdf` — forty pages —
 * written for the run; the settings are put back after it. The same on a phone at 390×844.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildLongPdf, buildPlainPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader scroll e2e'
const LONG = `${DIR}/long.pdf`
const PLAIN = `${DIR}/plain.pdf`

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const open = async (path) => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready', 15000)
    await until(() => view.engine.renderer.getContents().some((c) => c.doc.querySelector('#canvas img')), 8000)
    await wait(400)
    return { leaf, view }
  }
  const settings = async (over) => {
    const cfg = window.__abeleTest.AbeleConfig.getInstance()
    cfg.reader = { ...cfg.reader, ...over }
    await cfg.saveSettings()
    await wait(300)
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    44_000
  )

describe.skipIf(!available)('a PDF as one continuous scroll', () => {
  let saved: unknown = null

  beforeAll(() => {
    saved = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    const files = {
      'long.pdf': Buffer.from(buildLongPdf(40)).toString('base64'),
      'plain.pdf': Buffer.from(buildPlainPdf()).toString('base64'),
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
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, pdfLayout: 'scrolled', pdfZoom: 'fit-width' }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        // Kept on this side: the phone part reloads the app, and the page's own memory with it.
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(saved)}
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  it('lays the pages under each other and draws only those near the screen', () => {
    const r = run<{
      error?: string
      tag?: string
      slots?: number
      drawn?: number[]
      afterScroll?: { index: number; chapter: string; drawn: number[] }
      findings?: string[]
      sandbox?: string | null
    }>(`
      const { leaf, view } = await open(${JSON.stringify(LONG)})
      await view.engine.goTo(0)
      await wait(600)
      const r = view.engine.renderer
      const drawn = () => r.getContents().map((c) => c.index).sort((a, b) => a - b)
      const out = { tag: r.localName, drawn: drawn(), findings: view.pages.flatMap((p) => p.findings), sandbox: view.pages[0]?.sandbox }
      // Scrolled by hand, the way a person scrolls: the page being read follows.
      for (let i = 0; i < 12; i++) { await r.next(); await wait(120) }
      await wait(800)
      out.afterScroll = { index: r.index, chapter: view.model.chapter, drawn: drawn() }
      leaf.detach()
      return out
    `)
    expect(r.error).toBeUndefined()
    expect(r.tag).toBe('abele-pdf-scroll')
    expect(r.drawn!.length).toBeGreaterThan(0)
    expect(r.drawn!.length).toBeLessThan(8)
    expect(r.drawn).toContain(0)
    expect(r.findings).toEqual([])
    expect(r.sandbox).toBe('allow-same-origin')
    expect(r.afterScroll!.index).toBeGreaterThan(3)
    expect(r.afterScroll!.chapter).toBe(`Page ${r.afterScroll!.index + 1} of 40`)
    expect(r.afterScroll!.drawn).toContain(r.afterScroll!.index)
    expect(r.afterScroll!.drawn).not.toContain(0)
    expect(r.afterScroll!.drawn.length).toBeLessThan(10)
  })

  it('follows links and the outline, and opens again on the page it was left on', () => {
    const r = run<{ error?: string; afterLink?: number; afterToc?: number; reopened?: number }>(`
      let { leaf, view } = await open(${JSON.stringify(PLAIN)})
      await view.engine.goTo(0)
      const doc = await until(() => view.engine.renderer.getContents().find((c) => c.index === 0 && c.doc.querySelector('.annotationLayer a[href^="["]'))?.doc, 8000)
      doc.querySelector('.annotationLayer a[href^="["]').click()
      await until(() => view.engine.renderer.index === 3, 5000)
      const afterLink = view.engine.renderer.index
      await view.engine.goTo(view.model.toc[0].children[0].href)
      await until(() => view.engine.renderer.index === 1, 5000)
      const afterToc = view.engine.renderer.index
      await view.engine.goTo(2)
      await wait(2000)
      leaf.detach()
      await wait(300)
      ;({ leaf, view } = await open(${JSON.stringify(PLAIN)}))
      await wait(800)
      const reopened = view.engine.renderer.index
      leaf.detach()
      return { afterLink, afterToc, reopened }
    `)
    expect(r.error).toBeUndefined()
    expect(r.afterLink).toBe(3)
    expect(r.afterToc).toBe(1)
    expect(r.reopened).toBe(2)
  })

  it('zooms by keys and by a pinch, keeping the page being read, and back to the setting', () => {
    const r = run<{
      error?: string
      before?: number
      afterIn?: number
      afterPinch?: number
      reset?: number
      index?: number
      same?: boolean
    }>(`
      const { leaf, view } = await open(${JSON.stringify(LONG)})
      await view.engine.goTo(5)
      await wait(600)
      const r = view.engine.renderer
      const before = r.scale
      view.zoom('in')
      await wait(400)
      const afterIn = r.scale
      const doc = r.getContents().find((c) => c.index === r.index).doc
      doc.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, bubbles: true, cancelable: true }))
      await wait(400)
      const afterPinch = r.scale
      const index = r.index
      view.zoom('reset')
      await wait(400)
      const out = { before, afterIn, afterPinch, reset: r.scale, index, same: r.index === 5 }
      leaf.detach()
      return out
    `)
    expect(r.error).toBeUndefined()
    expect(r.afterIn!).toBeGreaterThan(r.before!)
    expect(r.afterPinch!).toBeGreaterThan(r.afterIn!)
    expect(r.index).toBe(5)
    expect(r.reset).toBeCloseTo(r.before!, 3)
    expect(r.same).toBe(true)
  })

  it('switches to pages and back at the same page', () => {
    const r = run<{
      error?: string
      paged?: string
      pagedIndex?: number
      back?: string
      backIndex?: number
    }>(`
      let { leaf, view } = await open(${JSON.stringify(LONG)})
      await view.engine.goTo(7)
      await wait(2000)
      await settings({ pdfLayout: 'paginated' })
      await until(() => view.engine?.renderer?.localName === 'foliate-fxl' && view.model.status === 'ready', 10000)
      await wait(800)
      const paged = view.engine.renderer.localName
      const pagedIndex = view.engine.renderer.index
      await settings({ pdfLayout: 'scrolled' })
      await until(() => view.engine?.renderer?.localName === 'abele-pdf-scroll' && view.model.status === 'ready', 10000)
      await wait(800)
      const out = { paged, pagedIndex, back: view.engine.renderer.localName, backIndex: view.engine.renderer.index }
      leaf.detach()
      return out
    `)
    expect(r.error).toBeUndefined()
    expect(r.paged).toBe('foliate-fxl')
    expect(r.pagedIndex).toBe(7)
    expect(r.back).toBe('abele-pdf-scroll')
    expect(r.backIndex).toBe(7)
  })

  describe('on a phone', () => {
    const PHONE = { width: 390, height: 844 }
    let size: [number, number] = [0, 0]
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const reload = async (how: string): Promise<void> => {
      evalRaw(`(() => { setTimeout(() => { ${how} }, 50); return 'ok' })()`, 30_000)
      await pause(4000)
      const deadline = Date.now() + 60_000
      while (!hasTestApi() && Date.now() < deadline) await pause(1000)
    }
    const setWindowSize = async (w: number, h: number) => {
      evalRaw(
        `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${w}, ${h}); return 'ok' })()`,
        30_000
      )
      await pause(1500)
    }

    beforeAll(async () => {
      size = evalJson<[number, number]>(
        `require('@electron/remote').getCurrentWindow().getContentSize()`
      )
      await reload('app.emulateMobile(true)')
      await setWindowSize(PHONE.width, PHONE.height)
      await reload('window.location.reload()')
    }, 180_000)

    afterAll(async () => {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reload('app.emulateMobile(false)')
    }, 180_000)

    it('fits the page to the screen’s width, keeps clear of the bars, and scrolls', () => {
      const r = run<{
        error?: string
        phone?: boolean
        pageWidth?: number
        over?: number
        underBar?: number
        moved?: boolean
        shot?: string
      }>(`
        const { leaf, view } = await open(${JSON.stringify(LONG)})
        await view.engine.goTo(0)
        await wait(800)
        const frame = view.engine.renderer.getContents().find((c) => c.index === 0).doc.defaultView.frameElement.getBoundingClientRect()
        const whole = view.contentEl.querySelector('.abele-book-reader').getBoundingClientRect()
        const bar = document.querySelector('.mobile-navbar')?.getBoundingClientRect()
        const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
        const shot = '/tmp/abele-phone/book-pdf-scroll.png'
        if (img) { require('fs').mkdirSync('/tmp/abele-phone', { recursive: true }); require('fs').writeFileSync(shot, img.toPNG()) }
        await view.engine.renderer.next()
        await wait(600)
        const out = {
          phone: document.body.classList.contains('is-phone'),
          pageWidth: Math.round(frame.width),
          over: Math.max(0, Math.round(Math.max(frame.right, whole.right) - window.innerWidth)),
          underBar: bar && bar.height ? Math.max(0, Math.round(whole.bottom - bar.top)) : 0,
          moved: view.model.fraction > 0.03,
          shot: img ? shot : 'no picture',
        }
        leaf.detach()
        return out
      `)
      expect(r.error).toBeUndefined()
      expect(r.phone).toBe(true)
      // The whole width, less the gaps either side.
      expect(r.pageWidth).toBeGreaterThan(PHONE.width - 40)
      expect(r.over).toBe(0)
      expect(r.underBar).toBe(0)
      expect(r.moved).toBe(true)
    })
  })
})
