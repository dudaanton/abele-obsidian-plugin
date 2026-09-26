/**
 * Scripts run on words in a book, and notes linking into a book marked in it, in the running app.
 *
 * With the rich book and the plain PDF and a scripts folder of the run's own (all written for the
 * run and removed after it):
 *
 * - a script whose header says `@book` has a button on the selection bar; pressed on selected
 *   words it runs with `book` — the words, their sentence, a link to the place — and its
 *   `selection` parameter filled, and here makes a card note holding the link;
 * - the words the card links to are marked (a dotted underline) and a tap on them opens the card;
 *   a second note linking to the same place makes the tap a menu of both; deleting the notes
 *   takes the mark away;
 * - "Run a script on these words" lists every script;
 * - in a PDF the same card is marked over the page, and a tap opens it;
 * - on a phone (390×844, `emulateMobile`) the bar with the script's button is one row, pictured to
 *   `/tmp/abele-phone/book-scripts-bar.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader scripts e2e'
const BOOK = `${DIR}/rich.epub`
const PDF = `${DIR}/plain.pdf`
const SCRIPTS = `${DIR}/Scripts`
const CARDS = `${DIR}/Cards`
const SHOTS = '/tmp/abele-phone'

const SCRIPT = `// @name E2E word card
// @description Makes a card for the words, linking back to the book
// @icon languages
// @book
// @param word string "Word" selection
const path = ${JSON.stringify(CARDS)} + '/' + params.word.replace(/[^\\p{L}\\p{N} ]/gu, '') + '.md'
await create(path, '**' + params.word + '**\\n\\n> ' + book.sentence + '\\n> — ' + book.link + '\\n\\n' + book.title + ' / ' + book.chapter + '\\n')
return path`

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const reload = async (how: string): Promise<void> => {
  evalRaw(`(() => { setTimeout(() => { ${how} }, 50); return 'ok' })()`, 30_000)
  await pause(4000)
  const deadline = Date.now() + 60_000
  while (!hasTestApi() && Date.now() < deadline) await pause(1000)
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`
  )
}
const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const open = async (path) => {
    const old = app.workspace.getLeavesOfType('abele-book')
    let main = null
    app.workspace.iterateRootLeaves((l) => { if (!main) main = l })
    if (main) app.workspace.setActiveLeaf(main, { focus: false })
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = main ?? app.workspace.getLeaf(false) }
    await Promise.race([
      leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true }),
      wait(15000),
    ])
    for (const l of old) if (l !== leaf) l.detach()
    await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading, 15000)
    await wait(600)
    return { leaf, view: leaf.view }
  }
  const docOf = (view) => view.engine.renderer.getContents()[0].doc
  const paragraph = (doc) => [...doc.querySelectorAll('p')].find((x) => x.textContent.length > 40)
  const selectIn = async (view, chapter, from, to) => {
    await view.engine.goTo(view.model.toc[chapter].href); await wait(600)
    const doc = docOf(view)
    const p = paragraph(doc)
    const range = doc.createRange(); range.setStart(p.firstChild, from); range.setEnd(p.firstChild, to)
    doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
    await until(() => view.model.selection, 3000)
    await until(() => view.contentEl.querySelector('.abele-book-selection'), 3000)
    await wait(100)
    return range
  }
  const tapOn = (range) => {
    const doc = range.startContainer.ownerDocument
    const r = range.getClientRects()[0]
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    doc.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView, clientX: x, clientY: y }))
  }
  const read = async (path) => {
    const f = app.vault.getAbstractFileByPath(path)
    return f ? app.vault.read(f) : ''
  }
  const marks = (view) => view.engine.renderer.getContents()[0]?.overlayer?.element?.querySelectorAll('.abele-link-mark').length ?? 0
  const bookLeaf = () => app.workspace.getLeavesOfType('abele-book')[0]
  const closeOthers = () => {
    for (const l of app.workspace.getLeavesOfType('markdown')) l.detach()
  }
`

const run = <T>(body: string, timeout = 90_000): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    timeout
  )

describe.skipIf(!available)('scripts on words in a book, and notes linking into it', () => {
  let saved: { folder?: string; reader?: unknown } = {}
  let size: [number, number] = [0, 0]
  let card = ''

  beforeAll(() => {
    const files = {
      'rich.epub': Buffer.from(buildRichEpub()).toString('base64'),
      'plain.pdf': Buffer.from(buildPlainPdf()).toString('base64'),
    }
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    saved = evalJson(
      `({ folder: window.__abeleTest.AbeleConfig.getInstance().ai?.scriptsFolder ?? '', reader: window.__abeleTest.AbeleConfig.getInstance().reader })`
    )
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        await app.vault.createFolder(${JSON.stringify(SCRIPTS)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        await app.vault.create(${JSON.stringify(`${SCRIPTS}/card.js`)}, ${JSON.stringify(SCRIPT)})
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.ai.scriptsFolder = ${JSON.stringify(SCRIPTS)}
        config.reader = { ...config.reader, flow: 'paginated', pdfLayout: 'paginated' }
        await config.saveSettings()
        await window.__abeleTest.ScriptService.getInstance().discover()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(async () => {
    if (evalJson<boolean>('app.isMobile')) {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reload('app.emulateMobile(false)')
    }
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        for (const leaf of app.workspace.getLeavesOfType('markdown')) {
          if (leaf.view.file?.path.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        }
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.ai.scriptsFolder = ${JSON.stringify(saved.folder ?? '')}
        config.reader = ${JSON.stringify(saved.reader ?? {})}
        await config.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        await window.__abeleTest.ScriptService.getInstance().discover()
        return 'ok'
      })()`,
      60_000
    )
  }, 180_000)

  it('a @book script has a button on the bar, and runs on the words with book and the selection', () => {
    const r = run<{
      error?: string
      button?: boolean
      card?: string
      text?: string
      source?: string
      marked?: number
    }>(`
      const { view } = await open(${JSON.stringify(BOOK)})
      await selectIn(view, 2, 0, 5)
      const button = await until(() => view.contentEl.querySelector('.abele-book-selection [data-script="E2E word card"]'), 5000)
      if (!button) return { button: false }
      button.click()
      const card = await until(() => app.vault.getFiles().find((f) => f.path.startsWith(${JSON.stringify(CARDS)}))?.path, 10000)
      const text = await read(card)
      view.reading.clearSelection()
      const marked = await until(() => marks(view), 5000)
      const run = window.__abeleTest.ScriptRuns.getInstance().runs.value[0]
      return { button: true, card, text, source: run?.source, marked }
    `)
    expect(r.error).toBeUndefined()
    expect(r.button).toBe(true)
    card = r.card ?? ''
    expect(card).toBe(`${CARDS}/Plain.md`)
    expect(r.text).toMatch(/^\*\*Plain\*\*\n\n> Plain text of the ch/)
    expect(r.text).toMatch(/> — \[\[.*rich\.epub#cfi=\/6\/.*\]\]/)
    expect(r.source).toBe('book')
    expect(r.marked).toBeGreaterThan(0)
  })

  it('a tap on the marked words opens the card; two notes there make it a menu; gone with them', () => {
    const r = run<{
      error?: string
      opened?: string | null
      menu?: string[]
      after?: number
      picker?: string[]
    }>(`
      const view = bookLeaf().view
      app.workspace.setActiveLeaf(bookLeaf(), { focus: true })
      await view.engine.goTo(view.model.toc[2].href); await wait(700)
      const p = paragraph(docOf(view))
      const range = docOf(view).createRange(); range.setStart(p.firstChild, 1); range.setEnd(p.firstChild, 3)
      tapOn(range)
      const opened = await until(() => {
        const f = app.workspace.getActiveFile()
        return f?.path.startsWith(${JSON.stringify(CARDS)}) ? f.path : null
      }, 5000)
      closeOthers()
      app.workspace.setActiveLeaf(bookLeaf(), { focus: true })

      // A second note linking to the same words.
      const text = await read(${JSON.stringify(card)})
      const link = /\\[\\[[^\\]]*rich\\.epub#cfi=[^\\]]*\\]\\]/.exec(text)[0]
      await app.vault.create(${JSON.stringify(`${DIR}/Another note.md`)}, 'See ' + link + '\\n')
      await wait(1500)
      tapOn(range)
      const menu = await until(() => [...document.querySelectorAll('.menu .menu-item-title')].map((e) => e.textContent), 3000)
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      document.querySelector('.menu')?.remove()

      // Every script is offered by the picker.
      await selectIn(view, 2, 0, 5)
      view.contentEl.querySelector('.abele-book-selection__run-script').click()
      const picker = await until(() => [...document.querySelectorAll('.prompt .suggestion-item')].map((e) => e.textContent), 3000)
      document.querySelector('.prompt')?.closest('.modal-container')?.querySelector('.modal-bg')?.click()
      document.querySelector('.prompt input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      view.reading.clearSelection()

      for (const path of [${JSON.stringify(card)}, ${JSON.stringify(`${DIR}/Another note.md`)}])
        await app.vault.delete(app.vault.getAbstractFileByPath(path))
      const after = await until(() => marks(view) === 0 ? 'none' : null, 5000)
      return { opened, menu, after: after ? 0 : marks(view), picker }
    `)
    expect(r.error).toBeUndefined()
    expect(r.opened).toBe(card)
    expect(r.menu).toEqual(['Another note', 'Plain'])
    expect(r.picker?.some((t) => t.startsWith('E2E word card'))).toBe(true)
    expect(r.after).toBe(0)
  })

  it('in a PDF the card is marked over the page, and a tap on it opens the card', () => {
    const r = run<{ error?: string; card?: string; marked?: boolean; opened?: string | null }>(`
      const { view } = await open(${JSON.stringify(PDF)})
      if (view.model.panel) { view.model.panel = false; await wait(300) }
      await Promise.race([view.engine.goTo(0), wait(5000)])
      const doc = await until(() => view.engine.renderer.getContents().map((c) => c.doc).find((d) => d?.querySelector('.textLayer span')), 10000)
      if (!doc) return { error: 'the page never drew its text' }
      await wait(500)
      const span = doc.querySelector('.textLayer span')
      const range = doc.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 5)
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      const button = await until(() => view.contentEl.querySelector('.abele-book-selection [data-script="E2E word card"]'), 3000)
      button.click()
      const card = await until(() => app.vault.getFiles().find((f) => f.path.startsWith(${JSON.stringify(CARDS)}))?.path, 10000)
      view.reading.clearSelection()
      closeOthers()
      const page = await until(() => view.engine.renderer.getContents().map((c) => c.doc).find((d) => d?.querySelector('.abele-marks__box[data-link]')), 5000)
      if (!page) return { card, marked: false }
      const box = page.querySelector('.abele-marks__box[data-link]').getBoundingClientRect()
      const x = box.left + 2, y = box.top + box.height / 2
      page.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: page.defaultView, clientX: x, clientY: y }))
      const opened = await until(() => {
        const f = app.workspace.getActiveFile()
        return f?.path.startsWith(${JSON.stringify(CARDS)}) ? f.path : null
      }, 5000)
      closeOthers()
      await app.vault.delete(app.vault.getAbstractFileByPath(card))
      bookLeaf()?.detach()
      return { card, marked: true, opened }
    `)
    expect(r.error).toBeUndefined()
    expect(r.marked).toBe(true)
    expect(r.opened).toBe(r.card)
  })

  it('on a phone the bar with the script is one row', async () => {
    await reload('app.emulateMobile(true)')
    await setWindowSize(390, 844)
    await reload('window.location.reload()')
    const r = run<{ error?: string; bar?: number; foot?: number; button?: boolean }>(`
      // Scripts may be off in this vault: the run's folder is read by hand, as at the start.
      await window.__abeleTest.ScriptService.getInstance().discover()
      const { view } = await open(${JSON.stringify(BOOK)})
      await selectIn(view, 2, 0, 5)
      await wait(400)
      const bar = view.contentEl.querySelector('.abele-book-selection')
      const foot = view.contentEl.querySelector('.abele-book-reader__foot')
      const button = !!bar.querySelector('[data-script="E2E word card"]')
      const img = await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/book-scripts-bar.png', img.toPNG())
      view.reading.clearSelection()
      return { bar: bar.getBoundingClientRect().height, foot: foot.getBoundingClientRect().height, button }
    `)
    expect(r.error).toBeUndefined()
    expect(r.button).toBe(true)
    expect(Math.abs((r.bar ?? 0) - (r.foot ?? 0))).toBeLessThanOrEqual(1)
  }, 120_000)
})
