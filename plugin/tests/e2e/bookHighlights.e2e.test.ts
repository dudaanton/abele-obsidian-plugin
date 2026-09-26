/**
 * Highlights, links to places and search, in the running app, for a book and for a PDF.
 *
 * A book (`richBook.ts`) and a PDF (`pdfFixture.ts`) are written to a folder for the run, and the
 * folder — with the highlights notes the run makes beside them — is removed after it. Words are
 * selected the way a person's selection arrives: a range put into the page's own selection.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader highlights e2e'
const BOOK = `${DIR}/rich.epub`
const PDF = `${DIR}/plain.pdf`
const BOOK_NOTE = `${DIR}/rich highlights.md`
const PDF_NOTE = `${DIR}/plain highlights.md`

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
    await wait(600)
    return { leaf, view }
  }
  const pageDoc = (view) => view.engine.renderer.getContents()[0]?.doc
  /** Selects characters [from, to) of a text node the way a person's selection arrives. */
  const select = async (view, node, from, to) => {
    const doc = node.ownerDocument
    const range = doc.createRange()
    range.setStart(node, from)
    range.setEnd(node, to)
    doc.getSelection().removeAllRanges()
    doc.getSelection().addRange(range)
    return until(() => view.model.selection || view.model.active, 3000)
  }
  const read = async (path) => {
    const f = app.vault.getAbstractFileByPath(path)
    return f ? app.vault.read(f) : null
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    44_000
  )

describe.skipIf(!available)('highlights, links and search', () => {
  beforeAll(() => {
    const files = {
      'rich.epub': Buffer.from(buildRichEpub()).toString('base64'),
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
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        for (const leaf of app.workspace.getLeavesOfType('markdown'))
          if (leaf.view.file?.path?.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  it('highlights selected words of a book into a note beside it, and draws them', () => {
    const r = run<{
      error?: string
      selection?: { text: string; label: string }
      note?: string | null
      drawn?: number
      listed?: string[]
    }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(0)
      await wait(600)
      const p = pageDoc(view).getElementById('with-note')
      await select(view, p.firstChild, 2, 7)
      const selection = { ...view.model.selection }
      await view.reading.highlight('green')
      await until(() => view.model.highlights.length === 1, 5000)
      await wait(300)
      const drawn = view.engine.renderer.getContents()[0].overlayer.element.querySelectorAll('rect').length
      const listed = view.model.highlights.map((h) => h.text)
      leaf.detach()
      return { selection, note: await read(${JSON.stringify(BOOK_NOTE)}), drawn, listed }
    `)
    expect(r.error).toBeUndefined()
    expect(r.selection).toMatchObject({ text: 'claim', label: 'Chapter 1' })
    expect(r.note).toContain('type: book-highlights')
    expect(r.note).toContain('book: "[[rich.epub]]"')
    expect(r.note).toMatch(
      /> \[!quote\|green\] \[\[rich\.epub#cfi=\/6\/2!\/4\/4%5Bwith-note%5D,\/1:2,\/1:7\|Chapter 1\]\]\n> claim/
    )
    expect(r.drawn).toBeGreaterThan(0)
    expect(r.listed).toEqual(['claim'])
  })

  it('opens a highlight tapped on the page: recolour, comment, remove — each written to the note', () => {
    const r = run<{
      error?: string
      reopened?: number
      tapped?: string
      recolored?: string | null
      commented?: string | null
      removed?: string | null
      bar?: number
    }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(0)
      await until(() => view.engine.renderer.getContents()[0].overlayer?.element.querySelector('rect'), 5000)
      const reopened = view.engine.renderer.getContents()[0].overlayer.element.querySelectorAll('rect').length
      const doc = pageDoc(view)
      const text = doc.getElementById('with-note').firstChild
      const range = doc.createRange(); range.setStart(text, 3); range.setEnd(text, 4)
      const b = range.getBoundingClientRect()
      text.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView, clientX: b.left + 1, clientY: b.top + b.height / 2 }))
      await until(() => view.model.active, 3000)
      const tapped = view.model.active?.color
      const bar = [...view.contentEl.querySelectorAll('.abele-book-selection__actions .abele-obsidian-icon')]
        .map((el) => el.getAttribute('aria-label') ?? '')
        .filter((label) => !label.startsWith('Ask the agent')).length
      await view.reading.save({ ...view.model.active, color: 'pink' })
      const recolored = await read(${JSON.stringify(BOOK_NOTE)})
      await view.reading.save({ ...view.model.active, comment: 'Worth a source.' })
      const commented = await read(${JSON.stringify(BOOK_NOTE)})
      await view.reading.remove(view.model.active)
      const removed = await read(${JSON.stringify(BOOK_NOTE)})
      leaf.detach()
      return { reopened, tapped, recolored, commented, removed, bar }
    `)
    expect(r.error).toBeUndefined()
    expect(r.reopened).toBeGreaterThan(0)
    expect(r.tapped).toBe('green')
    expect(r.bar).toBe(6)
    expect(r.recolored).toContain('> [!quote|pink]')
    expect(r.commented).toMatch(/> claim\n>\n> Worth a source\./)
    expect(r.removed).not.toContain('[!quote')
    expect(r.removed).toContain('type: book-highlights')
  })

  it('follows the note when it is edited by hand: a highlight written there is drawn', () => {
    const r = run<{ error?: string; before?: number; after?: number; color?: string }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(0)
      await wait(500)
      const before = view.model.highlights.length
      const note = app.vault.getAbstractFileByPath(${JSON.stringify(BOOK_NOTE)})
      await app.vault.process(note, (md) => md + '\\n> [!quote|blue] [[rich.epub#cfi=/6/2!/4/4%5Bwith-note%5D,/1:2,/1:7|Chapter 1]]\\n> claim\\n')
      await until(() => view.model.highlights.length === before + 1, 8000)
      await wait(400)
      const color = view.model.highlights[0]?.color
      const after = view.engine.renderer.getContents()[0].overlayer.element.querySelectorAll('rect').length
      leaf.detach()
      return { before, after, color }
    `)
    expect(r.error).toBeUndefined()
    expect(r.before).toBe(0)
    expect(r.color).toBe('blue')
    expect(r.after).toBeGreaterThan(0)
  })

  it('opens the highlights note at the highlight asked about, found by its place, and flashes it there', () => {
    type Seen = { flashed: string[]; visible: boolean; cursor: number | null }
    const r = run<{ error?: string; preview?: Seen; source?: Seen }>(`
      const note = app.vault.getAbstractFileByPath(${JSON.stringify(BOOK_NOTE)})
      // A decoy with the same words at another place above, and enough text to scroll past.
      const filler = Array.from({ length: 80 }, (_, i) => 'Paragraph ' + (i + 1) + ' of my own notes.').join('\\n\\n')
      await app.vault.process(note, (md) => md.replace('\\n---\\n', '\\n---\\n\\n> [!quote|yellow] [[rich.epub#cfi=/6/2!/4/2,/1:0,/1:3|Chapter 1]]\\n> claim\\n\\n' + filler + '\\n'))
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await until(() => view.model.highlights.some((h) => h.color === 'blue'), 8000)
      const h = view.model.highlights.find((h) => h.color === 'blue')
      const mode = app.vault.getConfig('defaultViewMode')
      const out = {}
      try {
        for (const m of ['preview', 'source']) {
          app.vault.setConfig('defaultViewMode', m)
          await view.reading.openNote(h)
          const noteLeaf = app.workspace.getLeavesOfType('markdown').filter((l) => l.view.file?.path === ${JSON.stringify(BOOK_NOTE)}).pop()
          const nv = noteLeaf.view
          await wait(200)
          const els = [...nv.containerEl.querySelectorAll('.abele-line-flash')]
          const colour = (el) => (el.matches('[data-callout-metadata]') ? el : el.querySelector('[data-callout-metadata]'))?.getAttribute('data-callout-metadata') ?? 'none'
          const scroller = m === 'preview' ? nv.containerEl.querySelector('.markdown-reading-view .markdown-preview-view') : nv.containerEl.querySelector('.cm-scroller')
          const s = scroller.getBoundingClientRect()
          const b = els[0]?.getBoundingClientRect()
          out[m] = {
            flashed: els.map((el) => colour(el) + ':' + el.textContent.trim().slice(0, 40)),
            visible: !!b && b.top >= s.top && b.bottom <= s.bottom && scroller.scrollTop > 0,
            cursor: m === 'source' ? nv.editor.getCursor().line : null,
          }
          noteLeaf.detach()
        }
      } finally {
        app.vault.setConfig('defaultViewMode', mode)
      }
      leaf.detach()
      return out
    `)
    expect(r.error).toBeUndefined()
    for (const m of ['preview', 'source'] as const) {
      expect(r[m]?.flashed.length, m).toBeGreaterThan(0)
      expect(
        r[m]?.flashed.every((f) => f.startsWith('blue:') && f.includes('claim')),
        m
      ).toBe(true)
      expect(r[m]?.visible, m).toBe(true)
    }
    // The cursor stays out of the callout, so live preview keeps drawing it.
    expect(r.source?.cursor).toBe(0)
  })

  it('makes a link to the words selected, and a link like it opens the book there with them selected', () => {
    const r = run<{
      error?: string
      link?: string
      quote?: string
      arrived?: string
      chapter?: string
    }>(`
      let { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(2)
      await wait(600)
      const h1 = pageDoc(view).querySelector('h1')
      await select(view, h1.firstChild, 0, 7)
      const link = view.reading.linkTo(view.model.selection)
      const quoteNote = ${JSON.stringify(`${DIR}/quotes.md`)}
      await app.vault.create(quoteNote, '')
      const noteLeaf = app.workspace.getLeaf('tab')
      await noteLeaf.openFile(app.vault.getAbstractFileByPath(quoteNote))
      await wait(300)
      view.reading.quoteIntoNote({ ...view.model.selection })
      await wait(300)
      const quote = noteLeaf.view.editor.getValue()
      noteLeaf.detach()
      leaf.detach()
      await wait(300)
      const linktext = link.slice(2, link.indexOf('|'))
      await app.workspace.openLinkText(linktext, ${JSON.stringify(BOOK_NOTE)}, 'tab')
      const arrivedView = await until(() => app.workspace.getLeavesOfType('abele-book')[0]?.view, 5000)
      await until(() => arrivedView.model.status === 'ready', 10000)
      await wait(1200)
      const arrived = pageDoc(arrivedView).getSelection().toString()
      const chapter = arrivedView.model.chapter
      arrivedView.leaf.detach()
      return { link, quote, arrived, chapter }
    `)
    expect(r.error).toBeUndefined()
    expect(r.link).toMatch(/^\[\[rich\.epub#cfi=\/6\/6!\/4\/2%5Bc3%5D,\/1:0,\/1:7\|Chapter 3\]\]$/)
    expect(r.quote).toBe(`> Chapter\n> — ${r.link}`)
    expect(r.arrived).toBe('Chapter')
    expect(r.chapter).toBe('Chapter 3')
  })

  it('searches the whole book, chapter by chapter, and goes to a result', () => {
    const r = run<{ error?: string; groups?: string[]; count?: number; chapter?: string }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      view.openSearch()
      await view.reading.search('second note')
      const groups = view.model.search.groups.map((g) => g.label + ':' + g.hits.length)
      const count = view.model.search.count
      await view.reading.goToHit(view.model.search.groups[0].hits[0])
      await until(() => view.model.chapter === 'Notes', 5000)
      const chapter = view.model.chapter
      leaf.detach()
      return { groups, count, chapter }
    `)
    expect(r.error).toBeUndefined()
    expect(r.groups).toEqual(['Notes:1'])
    expect(r.count).toBe(1)
    expect(r.chapter).toBe('Notes')
  })

  it('does the same in a PDF: highlight, search, and a link to its words opens it here', () => {
    const r = run<{
      error?: string
      selection?: { text: string; label: string }
      boxes?: number
      note?: string | null
      search?: string[]
      found?: string
      openedIn?: string
      page?: number
      arrived?: string
    }>(`
      let { leaf, view } = await open(${JSON.stringify(PDF)})
      await view.engine.goTo(0)
      // Once the page has been drawn and has settled: a page drawn again replaces its text, and a
      // selection made in the text it replaced is lost.
      await until(() => pageDoc(view)?.querySelector('#canvas img') && pageDoc(view)?.querySelector('.textLayer span'), 8000)
      await wait(1000)
      const doc = pageDoc(view)
      const span = [...doc.querySelectorAll('.textLayer span')].find((s) => s.textContent.includes('quick brown'))
      const at = span.firstChild.textContent.indexOf('quick')
      await select(view, span.firstChild, at, at + 11)
      const selection = { ...view.model.selection }
      await view.reading.highlight('yellow')
      await until(() => doc.querySelector('.abele-marks__box'), 5000)
      const boxes = doc.querySelectorAll('.abele-marks__box').length
      const note = await read(${JSON.stringify(PDF_NOTE)})
      await view.reading.search('test document')
      const search = view.model.search.groups.map((g) => g.label)
      await view.reading.goToHit(view.model.search.groups[2].hits[0])
      await until(() => pageDoc(view)?.getSelection()?.toString(), 5000)
      const found = view.engine.renderer.index + ':' + pageDoc(view).getSelection().toString()
      leaf.detach()
      await wait(300)

      // The link in the note, clicked in reading view, while PDFs open in Obsidian's viewer.
      const noteLeaf = app.workspace.getLeaf('tab')
      await noteLeaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(PDF_NOTE)}), { state: { mode: 'preview' } })
      await app.workspace.revealLeaf(noteLeaf)
      const a = await until(() => noteLeaf.view.containerEl.querySelector('.markdown-reading-view a.internal-link[data-href*="cfi="]'), 8000)
      if (!a) return { error: 'no link in the note: ' + note + ' / ' + noteLeaf.view.getViewType() + ' ' + noteLeaf.view.getMode?.() + ' ' + [...noteLeaf.view.containerEl.querySelectorAll('a')].map((x) => x.getAttribute('data-href')).join(',') }
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
      const reader = await until(() => app.workspace.getLeavesOfType('abele-book')[0]?.view, 5000)
      await until(() => reader.model.status === 'ready', 10000)
      await until(() => pageDoc(reader)?.getSelection()?.toString(), 6000)
      const arrived = pageDoc(reader)?.getSelection()?.toString()
      const out = { selection, boxes, note, search, found, openedIn: reader.getViewType(), page: reader.engine.renderer.index, arrived }
      reader.leaf.detach()
      noteLeaf.detach()
      return out
    `)
    expect(r.error).toBeUndefined()
    expect(r.selection).toMatchObject({ text: 'quick brown', label: 'Page 1' })
    expect(r.boxes).toBeGreaterThan(0)
    expect(r.note).toMatch(
      /> \[!quote\|yellow\] \[\[plain\.pdf#cfi=\/6\/2!\/4\/4\/\d+,\/1:\d+,\/1:\d+\|Page 1\]\]\n> quick brown/
    )
    expect(r.search).toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5'])
    expect(r.found).toBe('2:test document')
    expect(r.openedIn).toBe('abele-book')
    expect(r.page).toBe(0)
    expect(r.arrived).toBe('quick brown')
  })
})
