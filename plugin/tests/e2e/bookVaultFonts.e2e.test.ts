/**
 * Fonts kept in the vault, in the running app: font files in the fonts folder become fonts the
 * reader offers, the text is set in the one chosen, and files added, renamed and removed are
 * followed while a book is open. Highlights stay on their words after the font arrives — changed
 * while reading, and on a fresh open with the font already chosen, where the page is first laid
 * out before the font is in (the class of the monospace offset on an iPhone, 2026-09-27).
 *
 * The font is built here (`tests/helpers/tinyFont.ts`): every letter a box 0.9 em wide, far wider
 * than any text font, so whether it is in use shows in how wide the words are.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { buildProseEpub } from '../fixtures/books/proseBook'
import { buildTinyFont } from '../helpers/tinyFont'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader vault fonts e2e'
const FONTS = `${DIR}/Fonts`
const BOOK = `${DIR}/prose.epub`
const FAMILY = 'Abele Tiny Wide'

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const REGULAR = b64(buildTinyFont({ family: FAMILY }))
const BOLD = b64(buildTinyFont({ family: FAMILY, subfamily: 'Bold', weight: 700 }))

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const cfg = window.__abeleTest.AbeleConfig.getInstance()
  const setReader = async (patch) => { cfg.reader = { ...cfg.reader, ...patch }; await cfg.saveSettings() }
  const fonts = () => window.__abeleTest.reader.fonts()
  const put = async (path, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    await app.vault.createBinary(path, bytes.buffer)
  }
  const R = (view) => view.engine.renderer
  const contents = (view) => R(view).getContents()[0]
  const ours = (doc) => [...doc.fonts].filter((f) => f.family.replace(/"/g, '') === ${JSON.stringify(FAMILY)})
  /** How wide the first ten letters of the page's first paragraph are. */
  const wordWidth = (doc) => {
    const text = doc.querySelector('p').firstChild
    const r = doc.createRange(); r.setStart(text, 0); r.setEnd(text, 10)
    return r.getBoundingClientRect().width
  }
  const boxes = (view, cfi) => {
    const c = contents(view)
    const frame = c.doc.defaultView.frameElement.getBoundingClientRect()
    const svg = c.overlayer.element.getBoundingClientRect()
    const drawn = [...c.overlayer.element.querySelectorAll('rect')]
      .map((r) => [Math.round(+r.getAttribute('x') + svg.left), Math.round(+r.getAttribute('y') + svg.top)])
    const range = view.engine.resolveNavigation(cfi).anchor(c.doc)
    const words = [...range.getClientRects()]
      .map((r) => [Math.round(r.left + frame.left), Math.round(r.top + frame.top)])
    return { drawn, words }
  }
  const openBook = async () => {
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
    await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
    const view = await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading && leaf.view)
    if (view.model.panel) { view.model.panel = false; await wait(400) }
    return view
  }
`

/** A probe run in the page, started and asked after, so a phone's slower run fits too. */
const run = async <T>(body: string): Promise<T> => {
  const out = await evalLong(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )
  try {
    return JSON.parse(out) as T
  } catch {
    throw new Error(`Not JSON from the app: ${out.slice(0, 400)}`)
  }
}

/** The desktop window's size, set or read; a phone's screen is what it is. */
const WINDOW = `(window.require ? window.require('@electron/remote').getCurrentWindow() : null)`

type Boxes = { drawn: number[][]; words: number[][] }

const onWords = (name: string, b: Boxes | undefined) => {
  expect(b?.drawn.length, `${name}: boxes drawn`).toBeGreaterThan(0)
  expect(b?.drawn.length, `${name}: one box per line`).toBe(b?.words.length)
  b?.drawn.forEach((d, i) => {
    expect(Math.abs(d[0] - b.words[i][0]), `${name}: box ${i} left`).toBeLessThanOrEqual(1)
    expect(Math.abs(d[1] - b.words[i][1]), `${name}: box ${i} top`).toBeLessThanOrEqual(1)
  })
}

describe.skipIf(!available)('fonts from the vault in the reader', () => {
  let savedReader: unknown = null
  let size: [number, number] = [0, 0]

  beforeAll(() => {
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    size = evalJson<[number, number]>(`${WINDOW}?.getContentSize() ?? [0, 0]`)
    const data = Buffer.from(buildProseEpub()).toString('base64')
    evalRaw(
      `(async () => {
        ${WINDOW}?.setContentSize(1280, 800)
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        await app.vault.createFolder(${JSON.stringify(FONTS)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, flow: 'paginated', columns: 2, font: 'serif', fontsFolder: ${JSON.stringify(FONTS)} }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        for (const leaf of app.workspace.getLeavesOfType('markdown'))
          if (leaf.view.file?.path?.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        const places = cfg.reader?.placesPath || 'abele-book-places.json'
        if (await app.vault.adapter.exists(places)) await app.vault.adapter.remove(places)
        if (${size[0]}) ${WINDOW}?.setContentSize(${size[0]}, ${size[1]})
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('sets the text in a font from the folder, and follows files added, renamed and removed', async () => {
    const r = await run<{
      error?: string
      families?: string[]
      serif?: number
      wide?: number
      faces?: string[][]
      withBold?: string[][]
      renamed?: string[][]
      boldOnly?: string[][]
      gone?: { families: string[]; faces: number; width: number }
      checked?: boolean
    }>(`
      await put(${JSON.stringify(`${FONTS}/AbeleTinyWide-Regular.ttf`)}, ${JSON.stringify(REGULAR)})
      await until(async () => { await fonts().ensure(); return fonts().families.value.length }, 5000)
      const families = fonts().families.value.map((f) => f.name)
      const view = await openBook()
      await wait(800)
      const doc = contents(view).doc
      const serif = wordWidth(doc)
      await setReader({ font: ${JSON.stringify(`vault:${FAMILY}`)} })
      await until(() => ours(doc).length === 1 && wordWidth(doc) > serif * 1.3, 8000)
      const wide = wordWidth(doc)
      const faces = () => ours(contents(view).doc).map((f) => [f.weight, f.style, f.status]).sort()
      const had = faces()
      const checked = doc.fonts.check('16px "${FAMILY}"')

      await put(${JSON.stringify(`${FONTS}/AbeleTinyWide-Bold.ttf`)}, ${JSON.stringify(BOLD)})
      await until(() => faces().length === 2, 5000)
      const withBold = faces()

      const bold = app.vault.getAbstractFileByPath(${JSON.stringify(`${FONTS}/AbeleTinyWide-Bold.ttf`)})
      await app.fileManager.renameFile(bold, ${JSON.stringify(`${FONTS}/Bold face.ttf`)})
      await wait(1000)
      const renamed = faces()

      await app.vault.delete(app.vault.getAbstractFileByPath(${JSON.stringify(`${FONTS}/AbeleTinyWide-Regular.ttf`)}))
      await until(() => faces().length === 1 && faces()[0][0] === '700', 5000)
      const boldOnly = faces()

      await app.vault.delete(app.vault.getAbstractFileByPath(${JSON.stringify(`${FONTS}/Bold face.ttf`)}))
      await until(() => faces().length === 0 && wordWidth(contents(view).doc) < wide * 0.8, 5000)
      const gone = {
        families: fonts().families.value.map((f) => f.name),
        faces: faces().length,
        width: wordWidth(contents(view).doc),
      }
      return { families, serif, wide, faces: had, withBold, renamed, boldOnly, gone, checked }
    `)
    expect(r.error).toBeUndefined()
    expect(r.families).toEqual([FAMILY])
    // The boxes are far wider than the serif's letters.
    expect(r.wide).toBeGreaterThan((r.serif ?? 0) * 1.3)
    expect(r.checked).toBe(true)
    expect(r.faces).toEqual([['400', 'normal', 'loaded']])
    expect(r.withBold).toEqual([
      ['400', 'normal', 'loaded'],
      ['700', 'normal', 'loaded'],
    ])
    expect(r.renamed).toEqual(r.withBold)
    expect(r.boldOnly).toEqual([['700', 'normal', 'loaded']])
    // The last file gone: the family is gone and the text is back in the serif behind it.
    expect(r.gone?.families).toEqual([])
    expect(r.gone?.faces).toBe(0)
    expect(r.gone?.width).toBeLessThan((r.wide ?? 0) * 0.8)
  })

  it('keeps highlights on their words once the font arrives, while reading and on a fresh open', async () => {
    const r = await run<{
      error?: string
      before?: Boxes
      changed?: Boxes
      reopened?: Boxes
      moved?: number
    }>(`
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      await setReader({ font: 'serif' })
      await put(${JSON.stringify(`${FONTS}/AbeleTinyWide-Regular.ttf`)}, ${JSON.stringify(REGULAR)})
      await until(async () => { await fonts().ensure(); return fonts().families.value.length }, 5000)
      let view = await openBook()
      await wait(800)
      await view.engine.goTo(view.model.toc[0].href); await wait(600)
      let doc = contents(view).doc
      const p = doc.querySelectorAll('p')[2]
      const text = p.firstChild
      const range = doc.createRange()
      range.setStart(text, 5); range.setEnd(text, Math.min(120, text.length))
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      const cfi = view.model.selection.cfi
      await view.reading.highlight('yellow')
      await until(() => contents(view).overlayer.element.querySelector('rect'), 5000)
      await wait(500)
      const before = boxes(view, cfi)

      // Chosen while reading: the words grow wide, the highlight goes with them.
      await setReader({ font: ${JSON.stringify(`vault:${FAMILY}`)} })
      await until(() => ours(doc).length === 1, 8000)
      await wait(1000)
      const changed = boxes(view, cfi)
      const moved = Math.abs(changed.words[changed.words.length - 1][0] - before.words[before.words.length - 1][0])
        + Math.abs(changed.words.length - before.words.length) * 100

      // A fresh open with the font already chosen: the page is laid out before the font is in.
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      await wait(500)
      view = await openBook()
      await until(() => contents(view)?.doc && ours(contents(view).doc).length === 1, 8000)
      await until(() => contents(view).overlayer.element.querySelector('rect'), 8000)
      await wait(1500)
      const reopened = boxes(view, cfi)
      return { before, changed, reopened, moved }
    `)
    expect(r.error).toBeUndefined()
    onWords('in the serif', r.before)
    // The font moved the words.
    expect(r.moved).toBeGreaterThan(20)
    onWords('after the font was chosen', r.changed)
    onWords('opened with the font chosen', r.reopened)
  })
})
