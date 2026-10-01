/** A device-local reader split reflows the page without moving marks off their words. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync, centreOf, realDrag } from './helpers/githubLive'
import { WAIT_PRELUDE } from './helpers/wait'
import { buildJustifiedEpub } from '../fixtures/books/justifiedBook'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample reader split'
const BOOK = `${DIR}/sample-book.epub`
const WIDTH_KEY = 'abele-book-panel-width'
const SHOTS = shotDir('abele-reader-split')
const VIEW = `app.workspace.getLeavesOfType('abele-book').find(l => l.view.file?.path === ${JSON.stringify(BOOK)})?.view`
const PRELUDE = `
  ${WAIT_PRELUDE}
  const need = async (fn, label) => { const v = await until(fn); if (!v) throw Error(label); return v }
  const open = async () => {
    let leaf; try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
    await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
    const v = await need(() => leaf.view.model?.status === 'ready' && leaf.view.reading && leaf.view, 'reader not ready')
    v.model.panelTab = 'search'; v.model.panel = true
    await need(() => v.contentEl.querySelector('.abele-book-reader__panel'), 'panel not open')
    await v.engine.goTo(0)
    await need(() => v.engine.renderer.getContents()[0]?.doc?.getElementById('p1-0-0'), 'chapter missing')
    return v
  }
  const measure = v => v.contentEl.querySelector('.abele-book-reader__panel').getBoundingClientRect().width
  const shoot = async name => {
    ${onPhone() ? `await window.__e2eHost.shot(${JSON.stringify(SHOTS)} + '/' + name + '.png')` : `const img = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + name + '.png', img.toPNG())`}
  }
`

type Geometry = {
  search: number[][]
  highlight: number[][]
  words: number[][]
  savedWords: number[][]
}
const GEOMETRY = `
  const contents = () => v.engine.renderer.getContents()[0]
  const range = length => {
    const doc = contents().doc, p = doc.getElementById('p1-0-0'), r = doc.createRange()
    r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, length); return r
  }
  const query = String(range(65)).split(' ').slice(0, 2).join(' ')
  const geometry = () => {
    const c = contents(), f = c.doc.defaultView.frameElement.getBoundingClientRect()
    const rect = b => [b.left, b.top, b.width, b.height]
    const words = r => [...r.getClientRects()].map(b => [b.left + f.left, b.top + f.top, b.width, b.height])
    const groups = [...c.overlayer.element.children]
    const boxes = g => [...g.querySelectorAll('rect')].map(r => rect(r.getBoundingClientRect()))
    // Search also marks later repetitions; measure the first hit against the first paragraph.
    return { search: boxes(groups.find(g => g.getAttribute('fill') === 'none')),
      highlight: groups.filter(g => g.getAttribute('fill') !== 'none').flatMap(boxes),
      words: words(range(query.length)), savedWords: words(range(65)) }
  }
  const settled = async () => {
    let previous = '', last
    const result = await until(() => {
      const g = geometry(), current = JSON.stringify(g); last = g
      const match = (a, b) => b.length > 0 && a.length === b.length && b.every((r, j) => r.every((n, i) => Math.abs(n - a[j][i]) < 1))
      const stable = current === previous; previous = current
      return stable && match(g.search, g.words) && match(g.highlight, g.savedWords) && g
    })
    if (!result) throw Error('marks did not settle on their words: ' + JSON.stringify(last))
    return result
  }
`

const assertGeometry = (g: Geometry) => {
  for (const [actual, expected] of [
    [g.search, g.words],
    [g.highlight, g.savedWords],
  ]) {
    expect(expected.length).toBeGreaterThan(0)
    expect(actual).toHaveLength(expected.length)
    expected.forEach((r, j) =>
      r.forEach((n, i) => expect(Math.abs(n - actual[j][i])).toBeLessThan(1))
    )
  }
}

describe.skipIf(!available)('reader navigation split', () => {
  let reader: unknown
  let eink: unknown
  let width: unknown
  let panels: boolean[]
  let size: number[]
  let zoom: number
  let places: { path: string; text: string | null }
  beforeAll(() => {
    reader = evalJson('window.__abeleTest.AbeleConfig.getInstance().reader')
    eink = evalJson('window.__abeleTest.reader.eink.state()')
    width = evalJson(`app.loadLocalStorage(${JSON.stringify(WIDTH_KEY)})`)
    panels = evalJson(
      `(() => { const w = app.workspace, p = [w.leftSplit.collapsed, w.rightSplit.collapsed]; w.leftSplit.collapse(); w.rightSplit.collapse(); return p })()`
    )
    places = evalAsync(
      `(async () => { const path = window.__abeleTest.AbeleConfig.getInstance().reader.placesPath || 'abele-book-places.json'; return { path, text: await app.vault.adapter.exists(path) ? await app.vault.adapter.read(path) : null } })()`
    )
    if (!onPhone()) {
      size = evalJson(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      zoom = evalJson(`require('@electron/remote').getCurrentWebContents().getZoomFactor()`)
      evalRaw(
        `require('@electron/remote').getCurrentWebContents().setZoomFactor(1); require('@electron/remote').getCurrentWindow().setContentSize(1280, 800)`
      )
    }
    evalRaw(`(async () => {
      app.saveLocalStorage(${JSON.stringify(WIDTH_KEY)}, null)
      window.__abeleTest.reader.eink.set({ on: false })
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
      const cfg = window.__abeleTest.AbeleConfig.getInstance(); cfg.reader = ${JSON.stringify(reader)}; await cfg.saveSettings()
      window.__abeleTest.reader.eink.set(${JSON.stringify(eink)})
      app.saveLocalStorage(${JSON.stringify(WIDTH_KEY)}, ${JSON.stringify(width)})
      const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}); if (dir) await app.vault.delete(dir, true)
      const saved = ${JSON.stringify(places)}
      if (saved && saved.text !== null) await app.vault.adapter.write(saved.path, saved.text)
      else if (saved && await app.vault.adapter.exists(saved.path)) await app.vault.adapter.remove(saved.path)
      if (!${panels?.[0] ?? true}) app.workspace.leftSplit.expand()
      if (!${panels?.[1] ?? true}) app.workspace.rightSplit.expand()
      ${!onPhone() && size ? `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]}); require('@electron/remote').getCurrentWebContents().setZoomFactor(${zoom})` : ''}
      return 'ok'
    })()`)
  })

  if (!onPhone()) {
    it('drags, reflows both marks and remembers the width after reopening the panel and book', () => {
      const before = evalAsync<{ width: number; geometry: Geometry }>(`(async () => {
        ${PRELUDE}
        const v = await open()
        await need(() => v.contentEl.querySelector('.abele-book-reader__resize'), 'the navigation panel has no divider')
        ${GEOMETRY}
        const selected = range(65), cfi = v.engine.getCFI(0, selected)
        const link = cfi.slice(8, -1).split('[').join('%5B').split(']').join('%5D')
        await app.vault.create(${JSON.stringify(`${DIR}/sample-book highlights.md`)}, ${JSON.stringify('---\ntype: book-highlights\nfile: "[[sample-book.epub]]"\n---\n\n> [!quote|yellow] [[sample-book.epub#cfi=')} + link + ${JSON.stringify('|Sample chapter]]\n> ')} + String(selected) + ${JSON.stringify('\n')})
        await v.reading.loadHighlights(); await v.reading.search(query); await v.reading.goToHit(v.model.search.groups[0].hits[0])
        return { width: measure(v), geometry: await settled() }
      })()`)
      assertGeometry(before.geometry)
      const handle = centreOf(`${VIEW}.contentEl.querySelector('.abele-book-reader__resize')`)
      expect(handle, 'the navigation panel has a draggable divider').not.toBeNull()
      expect(
        evalJson(
          `document.elementFromPoint(${handle!.x}, ${handle!.y}) === ${VIEW}.contentEl.querySelector('.abele-book-reader__resize')`
        )
      ).toBe(true)
      realDrag(handle!, { x: handle!.x - 60, y: handle!.y })
      const after = evalAsync<{
        width: number
        stored: number
        panel: number
        reopened: number
        geometry: Geometry
        reopenedGeometry: Geometry
      }>(`(async () => {
        ${PRELUDE}
        const v = ${VIEW}
        ${GEOMETRY}
        const geometryAfter = await settled(), width = measure(v), stored = app.loadLocalStorage(${JSON.stringify(WIDTH_KEY)})
        await shoot('desktop-resized')
        v.model.panel = false; await need(() => !v.contentEl.querySelector('.abele-book-reader__panel'), 'panel not closed')
        v.model.panel = true; await need(() => v.contentEl.querySelector('.abele-book-reader__panel'), 'panel not reopened')
        const panel = measure(v)
        v.leaf.detach()
        const next = await open()
        await next.reading.search(query); await next.reading.goToHit(next.model.search.groups[0].hits[0])
        return { width, stored, panel, reopened: measure(next), geometry: geometryAfter, reopenedGeometry: await (async () => {
          const v = next
          ${GEOMETRY}
          return settled()
        })() }
      })()`)
      expect(after.width).toBeCloseTo(before.width - 60, 0)
      expect(after.stored).toBeCloseTo(after.width, 0)
      expect(after.panel).toBeCloseTo(after.width, 0)
      expect(after.reopened).toBeCloseTo(after.width, 0)
      assertGeometry(after.geometry)
      assertGeometry(after.reopenedGeometry)
      expect(after.geometry.savedWords).not.toEqual(before.geometry.savedWords)
    })

    it('clamps to the split limits and double-click resets to the original width', () => {
      const r = evalAsync<{
        min: number
        max: number
        small: number
        large: number
        reset: number
        default: number
        stored: unknown
      }>(`(async () => {
        ${PRELUDE}
        const v = await open(), handle = v.contentEl.querySelector('.abele-book-reader__resize')
        const key = async key => { handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); await wait(100) }
        const min = Number(handle.getAttribute('aria-valuemin')), max = Number(handle.getAttribute('aria-valuemax'))
        await key('Home'); await key('ArrowLeft'); const small = measure(v)
        await key('End'); await key('ArrowRight'); const large = measure(v)
        handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); await wait(100)
        const layout = v.contentEl.querySelector('.abele-book-reader')
        return { min, max, small, large, reset: measure(v), default: Math.min(parseFloat(getComputedStyle(layout).fontSize) * 21, layout.clientWidth * 0.4), stored: app.loadLocalStorage(${JSON.stringify(WIDTH_KEY)}) }
      })()`)
      expect(r.small).toBeCloseTo(r.min, 0)
      expect(r.large).toBeCloseTo(r.max, 0)
      expect(r.reset).toBeCloseTo(r.default, 0)
      expect(r.stored).toBeNull()
    })
  }

  it('keeps the phone drawer over a full-width page regardless of the saved desktop size', async () => {
    if (!onPhone()) {
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      await reloadApp('app.emulateMobile(true)')
    }
    const r = evalAsync<{
      page: number
      panel: number
      width: number
      handleHidden: boolean
      tabindex: number
      stored: number
    }>(`(async () => {
      ${PRELUDE}
      app.saveLocalStorage(${JSON.stringify(WIDTH_KEY)}, 450)
      const v = await open()
      await wait(300)
      const panel = v.contentEl.querySelector('.abele-book-reader__panel').getBoundingClientRect()
      const handle = v.contentEl.querySelector('.abele-book-reader__resize')
      await shoot('phone-drawer')
      return { page: v.engine.getBoundingClientRect().width, panel: panel.width,
        width: v.contentEl.querySelector('.abele-book-reader').clientWidth,
        handleHidden: !!handle && getComputedStyle(handle).display === 'none', tabindex: handle?.tabIndex,
        stored: app.loadLocalStorage(${JSON.stringify(WIDTH_KEY)}) }
    })()`)
    expect(r.page).toBeCloseTo(r.width, 0)
    expect(r.panel).toBeLessThan(r.width)
    expect(r.handleHidden).toBe(true)
    expect(r.tabindex).toBe(-1)
    expect(r.stored).toBe(450)
  })
})
