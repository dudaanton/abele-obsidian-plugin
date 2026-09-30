/** Search and saved highlights track the actual words, including same-size late reflows. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { buildJustifiedEpub } from '../fixtures/books/justifiedBook'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample overlay reflow'
const BOOK = `${DIR}/sample-book.epub`
const SHOTS = shotDir('abele-overlay-reflow')

type Check = {
  name: string
  search: number[][]
  highlight: number[][]
  words: number[][]
  savedWords: number[][]
  block: number[]
}
type Report = { error?: string; checks: Check[]; count: number }

describe.skipIf(!available)('book overlay reflow', () => {
  let savedReader: unknown
  let savedEink: unknown
  let size: number[]
  let zoom: number
  let panels: boolean[]
  let savedPlaces: { path: string; text: string | null }
  beforeAll(() => {
    savedReader = evalJson('window.__abeleTest.AbeleConfig.getInstance().reader')
    // This probe measures filled rectangles; e-ink uses lines and is device-local, not reader config.
    savedEink = evalJson('window.__abeleTest.reader.eink.state()')
    evalRaw('window.__abeleTest.reader.eink.set({ on: false })')
    savedPlaces = JSON.parse(
      evalRaw(`(async () => {
      const path = window.__abeleTest.AbeleConfig.getInstance().reader.placesPath || 'abele-book-places.json'
      return JSON.stringify({path, text: await app.vault.adapter.exists(path) ? await app.vault.adapter.read(path) : null})
    })()`)
    )
    panels = evalJson(
      `(() => { const w = app.workspace; const p = [w.leftSplit.collapsed, w.rightSplit.collapsed]; w.leftSplit.collapse(); w.rightSplit.collapse(); return p })()`
    )
    if (!onPhone()) {
      zoom = evalJson(`require('@electron/remote').getCurrentWebContents().getZoomFactor()`)
      evalRaw(`require('@electron/remote').getCurrentWebContents().setZoomFactor(1)`)
      size = evalJson(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(1280, 800)`)
    }
    evalRaw(`(async () => {
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      cfg.reader = { ...cfg.reader, flow: 'paginated', columns: 1, font: 'serif', fontSize: 100, lineHeight: 1.5, maxWidth: 1000, bookStyles: true, notesTo: 'book', bookNotes: {} }
      await cfg.saveSettings()
      await app.vault.createFolder(${JSON.stringify(DIR)})
      const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(buildJustifiedEpub()).toString('base64'))}), c => c.charCodeAt(0))
      await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
      return 'ok'
    })()`)
  })

  afterAll(async () => {
    if (!onPhone()) await reloadApp('app.emulateMobile(false)')
    evalRaw(`(async () => {
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) if (leaf.view.file?.path === ${JSON.stringify(BOOK)}) leaf.detach()
      for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf.view.file?.path?.startsWith(${JSON.stringify(DIR)})) leaf.detach()
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      cfg.reader = ${JSON.stringify(savedReader)}
      await cfg.saveSettings()
      window.__abeleTest.reader.eink.set(${JSON.stringify(savedEink)})
      const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (dir) await app.vault.delete(dir, true)
      const places = ${JSON.stringify(savedPlaces)}
      if (places && places.text !== null) await app.vault.adapter.write(places.path, places.text)
      else if (places && await app.vault.adapter.exists(places.path)) await app.vault.adapter.remove(places.path)
      const w = app.workspace
      if (!${panels?.[0] ?? true}) w.leftSplit.expand()
      if (!${panels?.[1] ?? true}) w.rightSplit.expand()
      ${!onPhone() && size ? `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]}); require('@electron/remote').getCurrentWebContents().setZoomFactor(${zoom})` : ''}
      return 'ok'
    })()`)
  }, 90000)

  const probe = async (mobile: boolean): Promise<Report> =>
    JSON.parse(
      await evalLong(
        `(async () => {
    ${WAIT_PRELUDE}
    const ready = async (fn, label) => {
      const value = await until(fn)
      if (!value) throw Error('Timed out: ' + label)
      return value
    }
    try {
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      let leaf; try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
      await leaf.setViewState({ type:'abele-book', state:{file:${JSON.stringify(BOOK)}}, active:true })
      const v = await ready(() => leaf.view.model?.status === 'ready' && leaf.view.reading && leaf.view, 'reader ready')
      v.model.panel = false
      await v.engine.goTo(0)
      const contents = () => v.engine.renderer.getContents()[0]
      const doc = await ready(() => contents()?.doc?.getElementById('p1-0-0') && contents().doc, 'fixture chapter')
      await doc.fonts.ready
      const p = doc.getElementById('p1-0-0')
      // Read the target directly from the fixture, not by resolving the place used to draw it.
      const range = (length) => { const r=doc.createRange(); r.setStart(p.firstChild,0); r.setEnd(p.firstChild,length); return r }
      const query = p.firstChild.data.split(' ').slice(0,2).join(' ')
      const selected = range(65)
      const cfi = v.engine.getCFI(0, selected)
      const link = cfi.slice(8,-1).replace(/\\[/g,'%5B').replace(/\\]/g,'%5D')
      const note = '---\\ntype: book-highlights\\nfile: "[[sample-book.epub]]"\\n---\\n\\n> [!quote|yellow] [[sample-book.epub#cfi=' + link + '|Sample chapter]]\\n> ' + String(selected) + '\\n'
      const path = ${JSON.stringify(`${DIR}/sample-book highlights.md`)}
      const old = app.vault.getAbstractFileByPath(path)
      if (old) await app.vault.modify(old,note); else await app.vault.create(path,note)
      await v.reading.loadHighlights()
      await ready(() => v.model.highlights.length, 'saved highlight')
      await v.reading.search(query)
      // The fixture repeats words later. Only the first hit is in our target paragraph.
      const hit = v.model.search.groups[0].hits[0]
      await v.reading.goToHit(hit)
      const checks = []
      const rect = r => [r.left,r.top,r.width,r.height]
      const check = async (name, applied = () => true) => {
        let previous = '', last = null
        const result = await until(() => {
          // Old rectangles can agree perfectly before Vue applies the requested change.
          if (!applied()) return false
          const c = contents(), frame = doc.defaultView.frameElement.getBoundingClientRect()
          const words = r => [...r.getClientRects()].map(b => [b.left+frame.left,b.top+frame.top,b.width,b.height])
          // Measure the drawn SVG itself, not attributes plus an assumed origin.
          const groups = [...c.overlayer.element.children]
          const search = [...groups.find(g => g.getAttribute('fill') === 'none').querySelectorAll('rect')].map(r => rect(r.getBoundingClientRect()))
          const highlight = groups.filter(g => g.getAttribute('fill') !== 'none').flatMap(g => [...g.querySelectorAll('rect')].map(r => rect(r.getBoundingClientRect())))
          last = {name,search,highlight,words:words(range(query.length)),savedWords:words(range(65)),block:rect(p.getBoundingClientRect())}
          const matches = (actual, expected) => expected.length > 0 && actual.length === expected.length &&
            expected.every((w,j) => actual[j].every((value,i) => Math.abs(value-w[i]) < 1))
          const current = JSON.stringify(last)
          const stable = current === previous
          previous = current
          return stable && matches(search,last.words) && matches(highlight,last.savedWords) && last
        })
        if (!result) throw Error(name + ': overlays did not settle on their words: ' + JSON.stringify(last))
        checks.push(result)
      }
      const shot = async name => {
        ${onPhone() ? `await window.__e2eHost.shot(${JSON.stringify(SHOTS)} + '/' + name + '.png')` : `const img = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + name + '.png', img.toPNG())`}
      }
      await check('initial')
      v.model.panelTab='search'; v.model.panel=true
      await check('sidebar open', () => !!v.contentEl.querySelector('.abele-book-reader__panel'))
      await shot(${JSON.stringify(mobile ? 'phone-sidebar' : 'desktop-sidebar')})
      v.model.panel=false
      await check('sidebar closed', () => !v.contentEl.querySelector('.abele-book-reader__panel'))
      ${!onPhone() ? `require('@electron/remote').getCurrentWindow().setContentSize(${mobile ? '430, 844' : '1100, 860'}); await check('resized', () => innerWidth === ${mobile ? 430 : 1100} && innerHeight === ${mobile ? 844 : 860})` : ''}
      ${!onPhone() && !mobile ? `for (const zoom of [0.9, 1.1, 1]) {
        const wc = require('@electron/remote').getCurrentWebContents()
        const width = innerWidth * wc.getZoomFactor() / zoom
        wc.setZoomFactor(zoom)
        await check('zoom '+zoom, () => Math.abs(wc.getZoomFactor() - zoom) < 0.001 && Math.abs(innerWidth - width) < 2)
      }` : ''}
      const fontSize = () => parseFloat(doc.defaultView.getComputedStyle(p).fontSize)
      const originalSize = fontSize()
      cfg.reader={...cfg.reader,font:'sans',fontSize:120}; await cfg.saveSettings()
      await check('reader font changed', () => fontSize() > originalSize)
      cfg.reader={...cfg.reader,font:'serif',fontSize:100}; await cfg.saveSettings()
      // Outlive the startup font-repair timers: a later change must not depend on their luck.
      await wait(13000)
      await check('before late paragraph style')
      p.style.setProperty('text-indent','4em','important')
      const beforeStyle = checks[checks.length - 1].words[0][0]
      await check('late paragraph style', () => {
        const frame = doc.defaultView.frameElement.getBoundingClientRect()
        return Math.abs(range(query.length).getClientRects()[0].left + frame.left - beforeStyle) > 10
      })
      await shot(${JSON.stringify(mobile ? 'phone-late' : 'desktop-late')})
      return JSON.stringify({checks,count:v.model.search.count})
    } catch (e) { return JSON.stringify({error:String(e.stack || e)}) }
  })()`,
        90000
      )
    ) as Report

  const assertReport = (report: Report) => {
    expect(report.error).toBeUndefined()
    expect(report.count).toBeGreaterThan(0)
    const contains = (actual: number[][], expected: number[][]) =>
      actual.length === expected.length &&
      expected.every((w, j) => actual[j].every((value, i) => Math.abs(value - w[i]) < 1))
    for (const check of report.checks) {
      expect(check.words.length, check.name).toBeGreaterThan(0)
      expect(
        contains(check.search, check.words),
        `${check.name}: search ${JSON.stringify(check)}`
      ).toBe(true)
      expect(
        contains(check.highlight, check.savedWords),
        `${check.name}: highlight ${JSON.stringify(check)}`
      ).toBe(true)
    }
    const before = report.checks.find((c) => c.name === 'before late paragraph style')!
    const after = report.checks.find((c) => c.name === 'late paragraph style')!
    expect(after.block.slice(2)).toEqual(before.block.slice(2))
    expect(Math.abs(after.words[0][0] - before.words[0][0])).toBeGreaterThan(10)
  }

  it('keeps search boxes and a saved highlight on their actual text through reflows', async () => {
    assertReport(await probe(onPhone()))
  }, 120000)

  if (!onPhone())
    it('keeps both marks on text in phone emulation', async () => {
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844)`)
      await reloadApp('app.emulateMobile(true)')
      assertReport(await probe(true))
    }, 150000)
})
