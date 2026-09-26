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
 * - the book menu: a pin in that list puts a script on the bar without running it, before the
 *   book header's; past three they fold into one button whose menu runs the one tapped, in an
 *   EPUB and in a PDF;
 * - in a PDF the same card is marked over the page, and a tap opens it;
 * - on a phone (390×844, `emulateMobile`) the bar with the script's button is one row, pictured to
 *   `/tmp/abele-phone/book-scripts-bar.png`; so are the folded button, its menu, the list with its
 *   pins and the book menu's settings, none reaching past the screen's edge.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, reloadApp } from './helpers/obsidianCli'
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

/** Plain scripts for the book menu: each says what it was given. */
const ECHO = (n: string) => `// @name E2E echo ${n}
// @param w string "W" selection
return '${n} ' + params.w`
const ECHOES = ['one', 'two', 'three']

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// Through the tier's own reload, so phone emulation stays this window's alone.
const reload = async (how: string): Promise<void> => {
  await reloadApp(how)
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
  let saved: { folder?: string; reader?: unknown; native?: boolean | null } = {}
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
      `({ folder: window.__abeleTest.AbeleConfig.getInstance().ai?.scriptsFolder ?? '', reader: window.__abeleTest.AbeleConfig.getInstance().reader, native: app.vault.getConfig('nativeMenus') ?? null })`
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
        for (const n of ${JSON.stringify(ECHOES)}) {
          const code = ${JSON.stringify(ECHO('@@'))}.split('@@').join(n)
          await app.vault.create(${JSON.stringify(SCRIPTS)} + '/echo-' + n + '.js', code)
        }
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.ai.scriptsFolder = ${JSON.stringify(SCRIPTS)}
        config.reader = { ...config.reader, flow: 'paginated', pdfLayout: 'paginated', selectionScripts: [] }
        await config.saveSettings()
        await window.__abeleTest.ScriptService.getInstance().discover()
        // A menu drawn by the page, not the system's: the system's cannot be read from here.
        app.vault.setConfig('nativeMenus', false)
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
        app.vault.setConfig('nativeMenus', ${JSON.stringify(saved.native ?? null)})
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
      if (view.model.panel) { view.model.panel = false; await wait(300) }
      await selectIn(view, 2, 0, 5)
      const button = await until(() => view.contentEl.querySelector('.abele-book-selection [data-script="E2E word card"]'), 5000)
      if (!button) return { button: false }
      button.click()
      const card = await until(() => app.vault.getFiles().find((f) => f.path.startsWith(${JSON.stringify(CARDS)}))?.path, 10000)
      const text = await read(card)
      view.reading.clearSelection()
      const marked = await until(() => marks(view), 5000)
      await wait(300)
      const img = await require('@electron/remote').getCurrentWebContents().capturePage()
      require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/book-scripts-mark.png', img.toPNG())
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
      why?: unknown
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
      // The page is made again once its tab shows again: the words are found on it anew.
      const p2 = paragraph(docOf(view))
      const again = docOf(view).createRange(); again.setStart(p2.firstChild, 1); again.setEnd(p2.firstChild, 3)
      tapOn(again)
      const titles = (sel) => { const t = [...document.querySelectorAll(sel)].map((e) => e.textContent); return t.length ? t : null }
      const menu = await until(() => titles('.menu .menu-item-title'), 3000)
      const why = { at: view.linked.places().map((c) => view.linked.at(c).map((n) => n.path)) }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      document.querySelector('.menu')?.remove()

      // Every script is offered by the picker.
      await selectIn(view, 2, 0, 5)
      view.contentEl.querySelector('.abele-book-selection__run-script').click()
      const picker = await until(() => titles('.prompt .suggestion-item'), 3000)
      document.querySelector('.prompt')?.closest('.modal-container')?.querySelector('.modal-bg')?.click()
      document.querySelector('.prompt input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      view.reading.clearSelection()

      for (const path of [${JSON.stringify(card)}, ${JSON.stringify(`${DIR}/Another note.md`)}])
        await app.vault.delete(app.vault.getAbstractFileByPath(path))
      const after = await until(() => marks(view) === 0 ? 'none' : null, 5000)
      return { opened, menu, why, after: after ? 0 : marks(view), picker }
    `)
    expect(r.error).toBeUndefined()
    expect(r.opened).toBe(card)
    expect(r.menu, JSON.stringify(r.why)).toEqual(['Another note', 'Plain'])
    expect(r.picker?.some((t) => t.startsWith('E2E word card'))).toBe(true)
    expect(r.after).toBe(0)
  })

  it('the book menu: pinned from the list without running, then folded into one menu past three', () => {
    const r = run<{
      error?: string
      stillOpen?: boolean
      ranOnPin?: number
      order?: string[]
      menu?: string[] | null
      ran?: { source?: string; result?: string } | null
      pdfFolded?: boolean
    }>(`
      const config = window.__abeleTest.AbeleConfig.getInstance()
      const runs = () => window.__abeleTest.ScriptRuns.getInstance().runs.value
      const bar = () => bookLeaf().view.contentEl.querySelector('.abele-book-selection')
      const titles = (sel) => { const t = [...document.querySelectorAll(sel)].map((e) => e.textContent); return t.length ? t : null }
      const { view } = await open(${JSON.stringify(BOOK)})
      if (view.model.panel) { view.model.panel = false; await wait(300) }
      await selectIn(view, 2, 0, 5)

      // A pin in the list of every script puts one on the bar, and runs nothing.
      bar().querySelector('.abele-book-selection__run-script').click()
      const rows = await until(() => { const r = [...document.querySelectorAll('.prompt .suggestion-item')]; return r.length ? r : null }, 3000)
      const row = rows.find((r) => r.querySelector('.suggestion-title')?.textContent === 'E2E echo one')
      const before = runs().length
      row.querySelector('.abele-book-script-pin').click()
      await until(() => config.reader.selectionScripts.some((c) => c.script === 'E2E echo one'), 3000)
      await wait(300)
      const stillOpen = !!document.querySelector('.prompt')
      const ranOnPin = runs().length - before
      document.querySelector('.prompt input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await until(() => !document.querySelector('.prompt'), 2000)
      if (!bar()) await selectIn(view, 2, 0, 5)
      await until(() => bar()?.querySelector('[data-script="E2E echo one"]'), 3000)
      const order = [...bar().querySelectorAll('.abele-book-selection__script')].map((b) => b.dataset.script)

      // Four on the menu: one button, whose menu runs the one tapped.
      config.reader = { ...config.reader, selectionScripts: [
        { script: 'E2E echo one', name: '', icon: '' },
        { script: 'E2E echo two', name: '', icon: '' },
        { script: 'E2E echo three', name: 'Third', icon: 'star' },
      ] }
      await config.saveSettings()
      const folded = await until(() => bar()?.querySelector('.abele-book-selection__scripts'), 3000)
      if (!folded) return { stillOpen, ranOnPin, order, menu: null }
      folded.click()
      const menu = await until(() => titles('.menu .menu-item-title'), 3000)
      ;[...document.querySelectorAll('.menu .menu-item')].find((i) => i.textContent.trim() === 'Third')?.click()
      const done = await until(() => runs().find((x) => x.name === 'E2E echo three' && x.status !== 'running'), 8000)
      view.reading.clearSelection()

      // The same in a PDF.
      const pdf = (await open(${JSON.stringify(PDF)})).view
      await Promise.race([pdf.engine.goTo(0), wait(5000)])
      const doc = await until(() => pdf.engine.renderer.getContents().map((c) => c.doc).find((d) => d?.querySelector('.textLayer span')), 10000)
      let pdfFolded = false
      if (doc) {
        await wait(500)
        const span = doc.querySelector('.textLayer span')
        const range = doc.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 5)
        doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
        await until(() => pdf.model.selection, 3000)
        pdfFolded = !!(await until(() => pdf.contentEl.querySelector('.abele-book-selection .abele-book-selection__scripts'), 3000))
        pdf.reading.clearSelection()
      }
      bookLeaf()?.detach()
      config.reader = { ...config.reader, selectionScripts: [] }
      await config.saveSettings()
      return { stillOpen, ranOnPin, order, menu, ran: done ? { source: done.source, result: done.result } : null, pdfFolded }
    `)
    expect(r.error).toBeUndefined()
    expect(r.stillOpen).toBe(true)
    expect(r.ranOnPin).toBe(0)
    expect(r.order).toEqual(['E2E echo one', 'E2E word card'])
    expect(r.menu).toEqual([
      'E2E echo one',
      'E2E echo two',
      'Third',
      'E2E word card',
      'Other script…',
    ])
    expect(r.ran).toEqual({ source: 'book', result: 'three Plain' })
    expect(r.pdfFolded).toBe(true)
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
    await reload('location.reload()')
    const r = run<{
      error?: string
      bar?: number
      foot?: number
      button?: boolean
      pins?: number
      pickerOver?: string[]
      folded?: boolean
      foldedRow?: number
      menuOver?: string[]
      settingsOver?: string[]
      entries?: number
    }>(`
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
      const shot = async (name) => {
        await wait(400)
        const img = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + name + '.png', img.toPNG())
      }
      // Whatever reaches past the right edge of the screen, by its class.
      const over = (root) => [...root.querySelectorAll('*')]
        .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > window.innerWidth + 1 })
        .map((e) => e.className && String(e.className).slice(0, 60))
      const config = window.__abeleTest.AbeleConfig.getInstance()
      const barRow = bar.getBoundingClientRect().height

      // The list of every script, a pin at the end of each row.
      bar.querySelector('.abele-book-selection__run-script').click()
      const prompt = await until(() => document.querySelector('.prompt .suggestion-item') && document.querySelector('.prompt'), 3000)
      await shot('book-scripts-picker')
      const pickerOver = prompt ? over(prompt) : ['no list']
      const pins = prompt ? prompt.querySelectorAll('.abele-book-script-pin').length : 0
      document.querySelector('.prompt input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await until(() => !document.querySelector('.prompt'), 2000)

      // Four on the menu: one button, and its menu.
      config.reader = { ...config.reader, selectionScripts: [
        { script: 'E2E echo one', name: '', icon: '' },
        { script: 'E2E echo two', name: 'Second one', icon: 'star' },
        { script: 'E2E echo three', name: '', icon: '' },
      ] }
      await config.saveSettings()
      if (!view.contentEl.querySelector('.abele-book-selection')) await selectIn(view, 2, 0, 5)
      const folded = await until(() => view.contentEl.querySelector('.abele-book-selection__scripts'), 3000)
      const bar2 = view.contentEl.querySelector('.abele-book-selection')
      const foldedRow = bar2 ? bar2.getBoundingClientRect().height : 0
      await shot('book-scripts-folded')
      folded?.click()
      const menuEl = await until(() => document.querySelector('.menu'), 3000)
      await shot('book-scripts-menu')
      const menuOver = menuEl ? over(menuEl) : ['no menu']
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      document.querySelector('.menu')?.remove()
      view.reading.clearSelection()

      // The book menu's settings, as a phone shows them.
      app.setting.open()
      app.setting.openTabById('abele')
      await until(() => document.querySelector('.abele-settings__nav .abele-tabs__tab'), 5000)
      ;[...document.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find((t) => t.textContent.trim() === 'Books')?.click()
      const section = await until(() => document.querySelector('.abele-book-scripts-settings'), 5000)
      let settingsOver = ['no section']
      let entries = 0
      if (section) {
        section.scrollIntoView({ block: 'start' })
        await shot('book-scripts-settings')
        settingsOver = over(section)
        entries = section.querySelectorAll('.abele-book-scripts-settings__entry').length
      }
      app.setting.close()
      config.reader = { ...config.reader, selectionScripts: [] }
      await config.saveSettings()
      return {
        bar: barRow, foot: foot.getBoundingClientRect().height, button,
        pins, pickerOver, folded: !!folded, foldedRow, menuOver, settingsOver, entries,
      }
    `)
    expect(r.error).toBeUndefined()
    expect(r.button).toBe(true)
    expect(Math.abs((r.bar ?? 0) - (r.foot ?? 0))).toBeLessThanOrEqual(1)
    expect(r.pins).toBeGreaterThan(3)
    expect(r.pickerOver).toEqual([])
    expect(r.folded).toBe(true)
    expect(Math.abs((r.foldedRow ?? 0) - (r.foot ?? 0))).toBeLessThanOrEqual(1)
    expect(r.menuOver).toEqual([])
    expect(r.entries).toBe(3)
    expect(r.settingsOver).toEqual([])
  }, 120_000)
})
