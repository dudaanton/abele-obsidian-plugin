/**
 * Words vocabulary rules name, underlined everywhere in a book, in the running app.
 *
 * With the vocabulary book (`tests/fixtures/books/vocabBook.ts`), written for the run and removed
 * after it:
 *
 * - a card whose properties name `māja`'s forms for this book underlines every one of them in the
 *   chapter — split across an `<em>`, in capitals — and not `maja` without its macron; a tap on one
 *   opens the card; a tap on the one that is the book's own link follows the link instead;
 * - a highlight on `kaķis`, given its forms from its bar, underlines the other `kaķis` — not its
 *   own words — and a tap on one opens the highlights note at the highlight, flashed; the forms are
 *   kept in the note as `forms::`;
 * - a card naming `kaķis` too: a tap on the highlighted words offers the highlight and the card, a
 *   tap on another `kaķis` a menu of both rules;
 * - switched off (`word-underline: false`, and "Stop underlining" on the highlight) the lines go;
 * - on a phone, a finger's tap on an underlined word opens the card, and a swipe turns to a page
 *   with its words underlined too (pictured to the phone's shots folder);
 * - the page turn with rules for a thousand words on the page is not much slower than with none,
 *   measured as the ratio of the two (the long chapter, where almost every word is underlined).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, evalLong } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { onPhone, targets } from './helpers/target'
import { swipe, tap } from './helpers/phone'
import { MADE_UP, VOCAB_COUNTS, buildVocabEpub } from '../fixtures/books/vocabBook'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele vocabulary e2e'
const BOOK = `${DIR}/words.epub`
const CARDS = `${DIR}/Cards`
const MANY = `${DIR}/Many`
const CARD = `${CARDS}/māja.md`
const CAT = `${CARDS}/kaķis.md`
const NOTE = `${DIR}/words highlights.md`
const SCRIPTS = `${DIR}/Scripts`
const API_CARD = `${CARDS}/nams.md`
const TERMS = `${DIR}/Terms.md`
const TERMS_FIELD = `${DIR}/Terms field.md`
const TEMPLATE = `${DIR}/Terms template.md`
/** A script keeping a card's rule the way a translating one would, twice, then switching it off. */
const SCRIPT = `// @name E2E vocabulary
const note = ${JSON.stringify(API_CARD)}
const first = await vocabulary.mark({ note, forms: ['nams', 'Nami'], books: [${JSON.stringify(BOOK)}], language: 'lv' })
const text = await read(note)
const again = await vocabulary.mark({ note, forms: 'nams, nami' })
const same = (await read(note)) === text
const added = await vocabulary.mark({ note, forms: ['namu'] })
await vocabulary.off(note)
const off = await vocabulary.get(note)
return JSON.stringify({ first, again, same, added: added.forms, off: off.on, text })`
/** How many made-up words get a rule each for the page-turn measure. */
const RULES = 1000

const SHOTS = process.env.ABELE_PHONE_SHOTS ?? '/tmp/abele-iphone'
const PRELUDE = `
  ${WAIT_PRELUDE}
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
  const ready = async (fn, label, ms = 8000) => {
    const value = await until(fn, ms)
    if (!value) throw Error('Timed out: ' + label)
    return value
  }
  const pageReady = async (view, index) => {
    const doc = await ready(() => {
      const c = view.engine.renderer.getContents()[0]
      if (index !== undefined && c?.index !== index) return false
      const bounds = c?.doc?.defaultView?.frameElement?.getBoundingClientRect()
      return bounds?.width > 0 && bounds.height > 0 && section(view)?.done && c.doc
    }, 'vocabulary page')
    await doc.fonts.ready
    return doc
  }
  const anchorReady = async (view, anchor, underlined = false) => {
    await view.engine.renderer.scrollToAnchor(anchor)
    await ready(() => {
      const doc = docOf(view), rect = anchor.getClientRects()[0]
      if (!rect || rect.width <= 0 || rect.right <= 0 || rect.left >= doc.defaultView.innerWidth ||
        rect.bottom <= 0 || rect.top >= doc.defaultView.innerHeight) return false
      return !underlined || drawn(view).some((d) => Math.abs(d.rect.left - rect.left) < 1 && Math.abs(d.rect.top - rect.top) < 1)
    }, 'anchor visible with current vocabulary marks')
  }
  const bookLeaf = () => app.workspace.getLeavesOfType('abele-book')[0]
  const open = async (path) => {
    const old = app.workspace.getLeavesOfType('abele-book')
    let main = null
    app.workspace.iterateRootLeaves((l) => { if (!main) main = l })
    if (main) app.workspace.setActiveLeaf(main, { focus: false })
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = main }
    await Promise.race([leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true }), wait(15000)])
    for (const l of old) if (l !== leaf) l.detach()
    await ready(() => leaf.view?.model?.status === 'ready' && leaf.view.reading, 'reader ready', 15000)
    if (leaf.view.model.panel) leaf.view.model.panel = false
    await ready(() => !leaf.view.contentEl.querySelector('.abele-book-reader__panel'), 'reader panel closed')
    await pageReady(leaf.view)
    return leaf.view
  }
  const docOf = (view) => view.engine.renderer.getContents()[0].doc
  const vocab = (view) => view.reading.marks.vocab
  const section = (view) => [...vocab(view).sections.values()].find((s) => s.doc === docOf(view))
  /** The words underlined on screen now: their text and where they are. */
  const drawn = (view) => (section(view)?.drawn ?? []).map((d) => ({
    text: section(view).text.text.slice(d.match.start, d.match.end), rect: d.rects[0],
  }))
  const lines = (view) => view.engine.renderer.getContents()[0]?.overlayer?.element?.querySelectorAll('.abele-vocab-mark').length ?? 0
  const tapAt = (doc, rect) => {
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
    const target = doc.elementFromPoint(x, y) ?? doc.body
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView, clientX: x, clientY: y }))
  }
  const titles = () => { const t = [...document.querySelectorAll('.menu .menu-item-title')].map((e) => e.textContent); return t.length ? t : null }
  const closeMenu = () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.querySelector('.menu')?.remove()
  }
  const activePath = () => app.workspace.getActiveFile()?.path ?? null
  const closeNotes = () => { for (const l of app.workspace.getLeavesOfType('markdown')) l.detach() }
  const backToBook = () => app.workspace.setActiveLeaf(bookLeaf(), { focus: true })
  const setProps = async (path, fn) => {
    await app.fileManager.processFrontMatter(app.vault.getAbstractFileByPath(path), fn)
  }
`

const run = <T>(body: string, timeout = 120_000): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    timeout
  )

/** `run` for a script that takes minutes: started in the page, and asked after every second. */
const runLong = async <T>(body: string, timeout: number): Promise<T> =>
  JSON.parse(
    await evalLong(
      `(async () => { ${PRELUDE}
        try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
      })()`,
      timeout
    )
  ) as T

describe.skipIf(!available)('words underlined everywhere in a book', () => {
  let saved: { reader?: unknown; native?: boolean | null; folder?: string } = {}

  beforeAll(() => {
    const epub = Buffer.from(buildVocabEpub()).toString('base64')
    saved = evalJson(
      `({ reader: window.__abeleTest.AbeleConfig.getInstance().reader, native: app.vault.getConfig('nativeMenus') ?? null, folder: window.__abeleTest.AbeleConfig.getInstance().ai?.scriptsFolder ?? '' })`
    )
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        await app.vault.createFolder(${JSON.stringify(CARDS)})
        await app.vault.createFolder(${JSON.stringify(MANY)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(epub)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.reader = { ...config.reader, flow: 'paginated', notesTo: 'book', notesTemplate: '' }
        await app.vault.createFolder(${JSON.stringify(SCRIPTS)})
        await app.vault.create(${JSON.stringify(`${SCRIPTS}/vocabulary.js`)}, ${JSON.stringify(SCRIPT)})
        await app.vault.create(${JSON.stringify(API_CARD)}, '**nams** — a house\\n')
        config.ai.scriptsFolder = ${JSON.stringify(SCRIPTS)}
        await config.saveSettings()
        await window.__abeleTest.ScriptService.getInstance().discover()
        // A menu drawn by the page, not the system's: the system's cannot be read from here.
        app.vault.setConfig('nativeMenus', false)
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
          if (leaf.view.file?.path.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        app.vault.setConfig('nativeMenus', ${JSON.stringify(saved.native ?? null)})
        const config = window.__abeleTest.AbeleConfig.getInstance()
        config.reader = ${JSON.stringify(saved.reader ?? {})}
        config.ai.scriptsFolder = ${JSON.stringify(saved.folder ?? '')}
        await config.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        await window.__abeleTest.ScriptService.getInstance().discover()
        return 'ok'
      })()`,
      120_000
    )
  }, 180_000)

  it('a card’s forms are underlined wherever they stand, and a tap on one opens the card', () => {
    const r = run<{
      error?: string
      found?: number
      onScreen?: string[]
      lines?: number
      opened?: string | null
      followed?: number | null
      openedByLink?: string | null
    }>(`
      await app.vault.create(${JSON.stringify(CARD)},
        '---\\nword-forms: [māja, mājas, mājā]\\nword-books: ["[[words.epub]]"]\\n---\\n**māja** — a house\\n')
      const view = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(view.model.toc[0].href)
      await until(() => vocab(view).count() > 0 && drawn(view).length, 8000)
      const found = vocab(view).count()
      const onScreen = drawn(view).map((d) => d.text)
      const count = lines(view)
      // A word that is not the book's link, tapped.
      const doc = docOf(view)
      const link = doc.getElementById('to-two')
      const plain = drawn(view).find((d) => !link.contains(doc.elementFromPoint(d.rect.left + 1, d.rect.top + 1)))
      tapAt(doc, plain.rect)
      const opened = await until(() => activePath() === ${JSON.stringify(CARD)} && activePath(), 5000)
      closeNotes(); backToBook()
      // The book's own link, underlined too, is followed.
      await anchorReady(view, link)
      const rect = link.getClientRects()[0]
      tapAt(doc, rect)
      const followed = await until(() => view.engine.renderer.getContents()[0]?.index === 1 ? 1 : null, 5000)
      return { found, onScreen, lines: count, opened, followed, openedByLink: activePath() }
    `)
    expect(r.error).toBeUndefined()
    expect(r.found).toBe(VOCAB_COUNTS.maja)
    expect(r.onScreen?.length).toBeGreaterThan(0)
    expect(
      r.onScreen?.every((w) =>
        /^(māja|mājas|mājā)$/i.test(w.split(String.fromCharCode(0xad)).join(''))
      )
    ).toBe(true)
    expect(r.lines).toBe(r.onScreen?.length)
    expect(r.opened).toBe(CARD)
    expect(r.followed).toBe(1)
    expect(r.openedByLink).toBe(BOOK)
  })

  it.skipIf(!onPhone())(
    'on a phone, a finger’s tap opens the card, and a swipe turns to more lines',
    async () => {
      const at = await runLong<{ error?: string; x?: number; y?: number; word?: string }>(
        `
      const view = bookLeaf().view
      closeNotes(); backToBook()
      await view.engine.goTo(view.model.toc[0].href)
      await pageReady(view, 0)
      await ready(() => drawn(view).length, 'underlined words', 5000)
      const doc = docOf(view)
      const link = doc.getElementById('to-two')
      const d = drawn(view).find((d) => !link.contains(doc.elementFromPoint(d.rect.left + 1, d.rect.top + 1)))
      const frame = doc.defaultView.frameElement.getBoundingClientRect()
      await window.__e2eHost?.shot(${JSON.stringify(`${SHOTS}/book-vocab-lines.png`)})
      return { x: Math.round(frame.left + d.rect.left + d.rect.width / 2), y: Math.round(frame.top + d.rect.top + d.rect.height / 2), word: d.text }
    `,
        120_000
      )
      expect(at.error).toBeUndefined()
      tap(at.x!, at.y!)
      const opened = await runLong<{
        error?: string
        opened?: string | null
        from?: number
        stage?: number[]
      }>(
        `
      const opened = await until(() => activePath() === ${JSON.stringify(CARD)} && activePath(), 5000)
      closeNotes(); backToBook()
      const view = bookLeaf().view
      await pageReady(view)
      const r = view.contentEl.getBoundingClientRect()
      return { opened, from: view.engine.renderer.start, stage: [r.left, r.top, r.width, r.height] }
    `,
        120_000
      )
      expect(opened.error).toBeUndefined()
      expect(opened.opened).toBe(CARD)
      const [left, top, width, height] = opened.stage!
      swipe(
        Math.round(left + width * 0.8),
        Math.round(top + height / 2),
        Math.round(left + width * 0.2),
        Math.round(top + height / 2)
      )
      const turned = await runLong<{ error?: string; to?: number; lines?: number }>(
        `
      const view = bookLeaf().view
      await ready(() => view.engine.renderer.start > ${opened.from} && drawn(view).length, 'swipe to underlined words', 5000)
      await window.__e2eHost?.shot(${JSON.stringify(`${SHOTS}/book-vocab-turned.png`)})
      return { to: view.engine.renderer.start, lines: drawn(view).length }
    `,
        120_000
      )
      expect(turned.error).toBeUndefined()
      expect(turned.to).toBeGreaterThan(opened.from!)
      expect(turned.lines).toBeGreaterThan(0)
    }
  )

  it('a highlight given forms from its bar underlines the word elsewhere, and a tap opens its entry', () => {
    const r = run<{
      error?: string
      prefilled?: string
      note?: string
      found?: number
      drawnHere?: string[]
      ownDrawn?: boolean
      opened?: string | null
      flashed?: boolean
    }>(`
      const view = bookLeaf().view
      backToBook()
      await view.engine.goTo(view.model.toc[0].href)
      const doc = await pageReady(view, 0)
      // The first kaķis, highlighted.
      const p = [...doc.querySelectorAll('p')].find((x) => x.textContent.includes('kaķis'))
      const node = [...p.childNodes].reverse().find((n) => n.nodeType === 3 && n.data.includes('kaķis'))
      const at = node.data.indexOf('kaķis')
      const range = doc.createRange(); range.setStart(node, at); range.setEnd(node, at + 5)
      await anchorReady(view, range)
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      await view.reading.highlight('green')
      const h = await until(() => view.model.highlights.find((x) => x.text === 'kaķis'), 5000)
      view.model.active = h
      const button = await until(() => view.contentEl.querySelector('.abele-book-selection__forms'), 3000)
      button.click()
      const input = await until(() => document.querySelector('.abele-book-forms textarea'), 3000)
      const prefilled = input.value
      document.querySelector('.modal .mod-cta').click()
      const note = await until(async () => {
        const t = await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))
        return t.includes('forms::') ? t : null
      }, 5000)
      await until(() => vocab(view).rules().some((r) => r.target.kind === 'highlight'), 5000)
      await until(() => drawn(view).some((d) => d.text === 'kaķis'), 5000)
      const found = section(view).matches.filter((m) => m.key === 'kaķis').length
      // Its own words are not underlined: only the highlight's colour is there.
      const own = doc.createRange(); own.setStart(node, at); own.setEnd(node, at + 5)
      const ownRect = own.getClientRects()[0]
      const ownDrawn = drawn(view).some((d) => Math.abs(d.rect.left - ownRect.left) < 1 && Math.abs(d.rect.top - ownRect.top) < 1)
      // Another kaķis, tapped.
      const last = [...doc.querySelectorAll('p')].reverse().find((x) => x.textContent.includes('kaķis'))
      const lastNode = [...last.childNodes].reverse().find((n) => n.nodeType === 3 && n.data.includes('kaķis'))
      const other = doc.createRange(); other.setStart(lastNode, lastNode.data.lastIndexOf('kaķis')); other.setEnd(lastNode, lastNode.data.lastIndexOf('kaķis') + 5)
      await anchorReady(view, other, true)
      const drawnHere = drawn(view).map((d) => d.text)
      view.model.active = null
      tapAt(doc, other.getClientRects()[0])
      const opened = await until(() => activePath() === ${JSON.stringify(NOTE)} && activePath(), 5000)
      const flashed = !!(await until(() => [...document.querySelectorAll('.abele-line-flash')].some((el) => el.textContent.includes('kaķis')), 3000))
      closeNotes(); backToBook()
      return { prefilled, note, found, drawnHere, ownDrawn, opened, flashed }
    `)
    expect(r.error).toBeUndefined()
    expect(r.prefilled).toBe('kaķis')
    expect(r.note).toContain('> forms:: kaķis')
    expect(r.found).toBe(VOCAB_COUNTS.kakis)
    expect(r.drawnHere).toContain('kaķis')
    expect(r.ownDrawn).toBe(false)
    expect(r.opened).toBe(NOTE)
    expect(r.flashed).toBe(true)
  })

  it('a card for the same word: the highlight and the card offered together, then both rules', () => {
    const r = run<{ error?: string; onHighlight?: string[] | null; elsewhere?: string[] | null }>(`
      await app.vault.create(${JSON.stringify(CAT)},
        '---\\nword-forms: [kaķis]\\nword-language: lv\\nword-scope: language\\n---\\n**kaķis** — a cat\\n')
      const view = bookLeaf().view
      backToBook()
      await until(() => vocab(view).rules().some((r) => r.id === 'note:' + ${JSON.stringify(CAT)}), 5000)
      await view.engine.goTo(view.model.toc[0].href)
      const doc = await pageReady(view, 0)
      const h = view.model.highlights.find((x) => x.text === 'kaķis')
      const anchor = view.engine.resolveNavigation(h.cfi).anchor(doc)
      await anchorReady(view, anchor, true)
      tapAt(doc, anchor.getClientRects()[0])
      const onHighlight = await until(titles, 3000)
      closeMenu(); view.model.active = null
      await ready(() => !document.querySelector('.menu') && !view.contentEl.querySelector('.abele-book-selection'), 'highlight menu and bar closed')
      const last = [...doc.querySelectorAll('p')].reverse().find((x) => x.textContent.includes('kaķis'))
      const lastNode = [...last.childNodes].reverse().find((n) => n.nodeType === 3 && n.data.includes('kaķis'))
      const other = doc.createRange(); other.setStart(lastNode, lastNode.data.lastIndexOf('kaķis')); other.setEnd(lastNode, lastNode.data.lastIndexOf('kaķis') + 5)
      await anchorReady(view, other, true)
      tapAt(doc, other.getClientRects()[0])
      const elsewhere = await until(titles, 3000)
      closeMenu()
      return { onHighlight, elsewhere }
    `)
    expect(r.error).toBeUndefined()
    expect(r.onHighlight).toEqual(['Highlight', 'kaķis'])
    expect(r.elsewhere?.sort()).toEqual(['kaķis', 'kaķis'])
  })

  it('switched off, the lines go: the card by its property, the highlight from its bar', () => {
    const r = run<{
      error?: string
      before?: number
      afterCard?: number
      afterAll?: number
      note?: string
    }>(`
      const view = bookLeaf().view
      backToBook()
      await view.engine.goTo(view.model.toc[0].href)
      await pageReady(view, 0)
      const before = vocab(view).count()
      await setProps(${JSON.stringify(CARD)}, (fm) => { fm['word-underline'] = false })
      await setProps(${JSON.stringify(CAT)}, (fm) => { fm['word-underline'] = false })
      const afterCard = await until(() => vocab(view).count() === ${VOCAB_COUNTS.kakis} ? vocab(view).count() : null, 5000)
      const h = view.model.highlights.find((x) => x.text === 'kaķis')
      view.model.active = h
      ;(await until(() => view.contentEl.querySelector('.abele-book-selection__forms'), 3000)).click()
      const stop = await until(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Stop underlining'), 3000)
      stop.click()
      await ready(() => vocab(view).count() === 0 && lines(view) === 0, 'vocabulary lines removed', 5000)
      const note = await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))
      return { before, afterCard, afterAll: lines(view) + vocab(view).count(), note }
    `)
    expect(r.error).toBeUndefined()
    expect(r.before).toBe(VOCAB_COUNTS.maja + VOCAB_COUNTS.kakis)
    expect(r.afterCard).toBe(VOCAB_COUNTS.kakis)
    expect(r.afterAll).toBe(0)
    expect(r.note).not.toContain('forms::')
  })

  it('a script keeps a card’s rule in one call, twice without a duplicate, and switches it off', () => {
    const r = run<{ error?: string; out?: string; ruled?: boolean }>(`
      const t = window.__abeleTest.ScriptService.getInstance()
      const s = t.getAll().find((x) => x.meta.name === 'E2E vocabulary')
      if (!s) return { error: 'the script was not discovered' }
      const out = await t.execute(s.path, {}, { source: 'command' })
      const view = bookLeaf().view
      // Switched off at the end: the book had it, and does not now.
      const ruled = !!(await until(() => !vocab(view).rules().some((r) => r.id === 'note:' + ${JSON.stringify(API_CARD)}), 5000))
      return { out, ruled }
    `)
    expect(r.error).toBeUndefined()
    const out = JSON.parse(r.out!.trim().split('\n').pop()!) as {
      first: { forms: string[]; books: string[]; language: string; on: boolean }
      again: { forms: string[] }
      same: boolean
      added: string[]
      off: boolean
      text: string
    }
    expect(out.first).toMatchObject({ forms: ['nams', 'Nami'], language: 'lv', on: true })
    expect(out.first.books).toEqual(['words.epub'])
    expect(out.again.forms).toEqual(['nams', 'Nami'])
    expect(out.same).toBe(true)
    expect(out.added).toEqual(['nams', 'Nami', 'namu'])
    expect(out.off).toBe(false)
    expect(out.text).toContain('**nams** — a house')
    expect(r.ruled).toBe(true)
  })

  it('the forms in a highlights note are a link: the book opens searched for them, stepped through', () => {
    const r = run<{
      error?: string
      linked?: string | null
      words?: string[]
      count?: number
      steps?: number[]
      field?: boolean
      again?: number
      closed?: boolean
    }>(`
      const view = bookLeaf().view
      // No highlight's bar left open by the tests before: it takes the row the search's bar is in.
      view.model.active = null
      view.reading.clearSelection()
      const cfi = view.engine.lastLocation.cfi
      const place = encodeURI(cfi.replace(/^epubcfi\\(|\\)$/g, '')).replace(/[#|]/g, (c) => encodeURIComponent(c))
      const callout = '# Terms\\n\\n> [!quote|yellow] [[words.epub#cfi=' + place + '|Vārdi]]\\n> māja\\n>\\n> forms:: māja, mājas, mājā\\n'
      await app.vault.create(${JSON.stringify(TERMS)}, callout)
      closeNotes()
      const leaf = app.workspace.getLeaf('tab')
      await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(TERMS)}, mode: 'preview' }, active: true })
      const link = await until(() => leaf.view.containerEl.querySelector('.markdown-reading-view a.abele-forms-link'), 5000)
      if (!link) return { linked: null }
      const linked = link.textContent
      view.reading.stopSearch()
      link.click()
      const searched = await until(() => bookLeaf().view.model.search.words && !bookLeaf().view.model.search.running && bookLeaf().view.model.search.count ? bookLeaf().view.model.search : null, 15000)
      const model = bookLeaf().view.model
      const words = [...(searched?.words ?? [])]
      const count = searched?.count
      const panel = model.panel && model.panelTab === 'search'
      // The bar under the page: on, on, back.
      const bar = () => bookLeaf().view.contentEl.querySelector('.abele-book-search-bar')
      const steps = []
      for (const [i, expected] of [[1, 0], [1, 1], [0, 0]]) {
        const control = await ready(() => bar()?.querySelectorAll('.abele-obsidian-icon')[i], 'search step control')
        control.click()
        await ready(() => model.search.current === expected, 'search step ' + expected)
        steps.push(model.search.current)
      }
      // The same from a template's field, in the editor.
      const config = window.__abeleTest.AbeleConfig.getInstance()
      await app.vault.create(${JSON.stringify(TEMPLATE)}, '{{#body}}\\n{{ quote }}\\n\\n**Forms:** {{ forms }}\\n{{/body}}\\n')
      config.reader = { ...config.reader, notesTemplate: ${JSON.stringify(TEMPLATE)} }
      await config.saveSettings()
      const withField = '# Terms\\n\\n> [!quote|yellow] [[words.epub#cfi=' + place + '|Vārdi]]\\n> māja\\n\\n**Forms:** mājas\\n'
      await app.vault.create(${JSON.stringify(TERMS_FIELD)}, withField)
      closeNotes()
      const editor = app.workspace.getLeaf('tab')
      await editor.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(TERMS_FIELD)}, mode: 'source', source: false }, active: true })
      const mark = await until(() => editor.view.containerEl.querySelector('.cm-content .abele-forms-link'), 5000)
      const field = !!mark && mark.textContent === 'mājas'
      if (mark) mark.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
      const again = await until(() => { const s = bookLeaf().view.model.search; return s.words?.join() === 'mājas' && !s.running ? s.count : null }, 15000)
      closeNotes(); backToBook()
      bar().querySelectorAll('.abele-obsidian-icon')[3].click()
      await ready(() => !bar() && bookLeaf().view.model.search.count === 0, 'search bar closed')
      const closed = !bar() && bookLeaf().view.model.search.count === 0
      return { linked, words, count, panel, steps, field, again, closed }
    `)
    expect(r.error).toBeUndefined()
    expect(r.linked).toBe('māja, mājas, mājā')
    expect(r.words).toEqual(['māja', 'mājas', 'mājā'])
    expect(r.count).toBe(VOCAB_COUNTS.maja)
    expect(r.steps).toEqual([0, 1, 0])
    expect(r.field).toBe(true)
    // `mājas` stands three times: twice in lower case, once in capitals.
    expect(r.again).toBe(3)
    expect(r.closed).toBe(true)
  })

  it(`the page turn with ${RULES} words underlined is not much slower than with none`, async () => {
    const r = await runLong<{
      error?: string
      none?: number[]
      many?: number[]
      rules?: number
      drawnOnPage?: number
      words?: number
      redrawNone?: number
      redrawMany?: number
      readMs?: number
    }>(
      `
      const view = await open(${JSON.stringify(BOOK)})
      const renderer = view.engine.renderer
      const animated = renderer.hasAttribute('animated')
      renderer.removeAttribute('animated')
      /** Turns ten pages from the start of the long chapter; how long each took, drawn. */
      const turns = async () => {
        await view.engine.goTo(view.model.toc[1].href)
        await pageReady(view, 1)
        const out = []
        for (let i = 0; i < 10; i++) {
          const t = performance.now()
          await view.engine.next()
          await frame(); await frame()
          out.push(performance.now() - t)
          // Benchmark pacing between samples, not a readiness wait: keep both runs identical.
          await wait(150)
        }
        return out
      }
      /** What drawing the marks over the page again costs, the work a turn adds, on average. */
      const redraw = () => {
        const overlayer = renderer.getContents()[0].overlayer
        const t = performance.now()
        for (let i = 0; i < 20; i++) overlayer.redraw()
        return (performance.now() - t) / 20
      }
      await turns()
      const none = await turns()
      const redrawNone = redraw()
      const words = ${JSON.stringify(MADE_UP.slice(0, RULES))}
      for (let i = 0; i < words.length; i++)
        await app.vault.create(${JSON.stringify(MANY)} + '/' + words[i] + '.md',
          '---\\nword-forms: [' + words[i] + ']\\nword-books: ["[[words.epub]]"]\\n---\\n')
      await until(() => vocab(view).rules().length >= ${RULES}, 60000)
      const rules = vocab(view).rules().length
      // The long chapter read afresh with the rules: how long until its words are known.
      vocab(view).kept.clear()
      await view.engine.goTo(view.model.toc[0].href)
      await pageReady(view, 0)
      const t = performance.now()
      await view.engine.goTo(view.model.toc[1].href)
      await until(() => vocab(view).count() > 0, 20000, 5)
      const readMs = performance.now() - t
      await until(() => drawn(view).length, 5000)
      await turns()
      const many = await turns()
      const redrawMany = redraw()
      const drawnOnPage = lines(view)
      if (animated) renderer.setAttribute('animated', '')
      return { none, many, rules, drawnOnPage, words: vocab(view).count(), redrawNone, redrawMany, readMs }
    `,
      300_000
    )
    expect(r.error).toBeUndefined()
    expect(r.rules).toBeGreaterThanOrEqual(RULES)
    expect(r.words).toBeGreaterThan(3000)
    expect(r.drawnOnPage).toBeGreaterThan(50)
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const ratio = median(r.many ?? []) / median(r.none ?? [])
    console.info(
      `page turn: ${median(r.none ?? []).toFixed(1)} ms with no rules, ${median(r.many ?? []).toFixed(1)} ms with ${r.rules} (${r.drawnOnPage} lines on screen), ratio ${ratio.toFixed(2)}; ` +
        `marks drawn again: ${r.redrawNone?.toFixed(2)} ms, ${r.redrawMany?.toFixed(2)} ms; the chapter's ${r.words} words found in ${r.readMs?.toFixed(0)} ms`
    )
    expect(ratio).toBeLessThan(1.5)
  }, 400_000)
})
