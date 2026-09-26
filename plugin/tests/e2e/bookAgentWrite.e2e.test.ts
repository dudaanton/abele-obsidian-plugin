/**
 * The agent working a book in the running app: listing the books, searching some chapters a page
 * at a time, highlighting words it quotes — in an EPUB and across two lines of a PDF — changing and
 * removing highlights, and bookmarking. What it marks is checked the way the reader sees it: the
 * book opened, the same words selected by hand, and the reader finding its highlight there — the
 * same place, not merely the same words. The files are written to a folder for the run and removed
 * after it, with the places and bookmarks files; the scope is put back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader agent write e2e'
const BOOK = `${DIR}/rich.epub`
const PDF = `${DIR}/plain.pdf`
const NOTE = `${DIR}/rich highlights.md`
const PDF_NOTE = `${DIR}/plain highlights.md`

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const tools = Object.fromEntries(window.__abeleTest.createBookTools().map((t) => [t.name, t]))
  const call = async (name, params = {}) => {
    try {
      const r = await tools[name].execute('t', params)
      return r.content.map((c) => c.text).join('')
    } catch (e) {
      return 'ERROR: ' + (e?.message ?? String(e))
    }
  }
  const read = async (path) => {
    const f = app.vault.getAbstractFileByPath(path)
    return f ? app.vault.read(f) : ''
  }
  const firstLink = (text, prefix) =>
    /\\[\\[[^\\]]+\\]\\]/.exec(text.split('\\n').find((l) => l.startsWith(prefix)) ?? '')?.[0]
  const open = async (path) => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready', 15000)
    await wait(600)
    return { leaf, view }
  }
  /** Selects words in a page by hand, as a person's drag would. */
  const select = (doc, from, fromOffset, to, toOffset) => {
    const range = doc.createRange()
    range.setStart(from, fromOffset)
    range.setEnd(to, toOffset)
    doc.getSelection().removeAllRanges()
    doc.getSelection().addRange(range)
  }
  const textNode = (doc, root, words) => {
    const walker = doc.createTreeWalker(root, 4)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.includes(words)) return n
    return null
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    44_000
  )

describe.skipIf(!available)('the agent marking books', () => {
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
        const scope = window.__abeleTest.ScopeResolver.getInstance()
        window.__abeleBookWriteE2E = {
          full: scope.fullVaultAccess.value,
          entries: JSON.parse(JSON.stringify(scope.entries.value)),
        }
        scope.clear()
        scope.setFullVaultAccess(false)
        scope.addFolder(${JSON.stringify(DIR)})
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const saved = window.__abeleBookWriteE2E
        if (saved) {
          const scope = window.__abeleTest.ScopeResolver.getInstance()
          scope.clear()
          for (const e of saved.entries) {
            if (e.type === 'file') scope.addFile(e.path)
            else if (e.type === 'folder') scope.addFolder(e.path)
            else if (e.type === 'pattern') scope.addPattern(e.path ?? e.pattern)
            else if (e.type === 'group') scope.addGroup(e.path)
          }
          scope.setFullVaultAccess(saved.full)
        }
        delete window.__abeleBookWriteE2E
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        await new Promise((r) => setTimeout(r, 1500))
        for (const f of ['abele-book-places.json', 'abele-book-bookmarks.json'])
          if (await app.vault.adapter.exists(f)) await app.vault.adapter.remove(f)
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  it('book_list lists the books in scope; book_search searches the parts named, a page at a time', () => {
    const r = run<{
      error?: string
      list?: string
      first?: string
      second?: string
      none?: string
    }>(`
      const list = await call('book_list')
      const first = await call('book_search', { book: ${JSON.stringify(BOOK)}, query: 'plain text', parts: '2', limit: 5 })
      const second = await call('book_search', { book: ${JSON.stringify(BOOK)}, query: 'plain text', parts: '2', limit: 5, after: 5 })
      const none = await call('book_search', { book: ${JSON.stringify(BOOK)}, query: 'second note', parts: '1-3' })
      return { list, first, second, none }
    `)
    expect(r.error).toBeUndefined()
    expect(r.list).toMatch(/^2 books:/)
    expect(r.list).toContain(`- ${BOOK}`)
    expect(r.list).toContain(`- ${PDF}`)
    expect(r.first).toMatch(/^60 finds of "plain text" in Rich test book in part 2; 1–5:/)
    const lines = (r.first ?? '').split('\n').filter((l) => /^\d+\. /.test(l))
    expect(lines).toHaveLength(5)
    for (const l of lines) expect(l).toMatch(/^\d+\. part 2 \[\[rich\.epub#cfi=/)
    expect(r.first).toContain('[More: book_search with after 5.]')
    // Each find is one short line of the words around it.
    const snippets = (r.first ?? '').split('\n').filter((l) => l.startsWith('   '))
    for (const s of snippets) expect(s.length).toBeLessThan(220)
    expect(r.second).toMatch(/; 6–10:/)
    expect(r.second).toMatch(/^6\. part 2/m)
    expect(r.none).toBe('"second note" is not in Rich test book in parts 1, 2, 3.')
  })

  it('highlights words it quotes at a find, where the reader finds them selected by hand', () => {
    const r = run<{
      error?: string
      refused?: string
      made?: string
      note?: string
      active?: string | null
      cfiMade?: string
      diag?: unknown
      edited?: string
      shown?: string
      removed?: string
      left?: number
      listed?: string
    }>(`
      for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
      // The same sentence is thirty times in a chapter: said where, or refused.
      const refused = await call('book_highlight', { book: ${JSON.stringify(BOOK)}, text: 'long enough to wrap onto several lines', part: 3 })
      const search = await call('book_search', { book: ${JSON.stringify(BOOK)}, query: 'Chapter 3, part two' })
      const link = firstLink(search, '1.')
      const made = await call('book_highlight', { book: link, text: 'Chapter 3, part two', color: 'green', note: 'Where the second half starts.' })
      const note = await read(${JSON.stringify(NOTE)})
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await until(() => view.model.highlights.length === 1, 5000)
      await view.engine.goTo(view.model.highlights[0].cfi)
      await wait(800)
      const content = view.engine.renderer.getContents().find((c) => c.doc.getElementById('c3-s2'))
      const heading = content?.doc.getElementById('c3-s2')
      const t = heading?.firstChild
      if (t) select(content.doc, t, 0, t, t.nodeValue.length)
      const active = await until(() => view.model.active?.cfi, 3000)
      const diag = { sel: view.model.selection?.cfi, hls: view.model.highlights.map((h) => h.cfi), found: !!t, contents: view.engine.renderer.getContents().length }
      const cfiMade = view.model.highlights[0]?.cfi
      const listed = await call('book_highlights', { book: ${JSON.stringify(BOOK)} })
      const hl = firstLink(listed, '1.')
      const edited = await call('book_highlight_edit', { highlight: hl, color: 'purple', note: '' })
      const shown = await until(() => view.model.highlights[0]?.color === 'purple' ? 'purple' : null, 5000)
      const removed = await call('book_highlight_remove', { highlight: hl })
      await until(() => view.model.highlights.length === 0, 5000)
      const left = view.model.highlights.length
      leaf.detach()
      return { diag, refused, made, note, active, cfiMade, edited, shown, removed, left, listed }
    `)
    expect(r.error).toBeUndefined()
    expect(r.refused).toMatch(/^ERROR: These words are in more than 20 places in part 3/)
    expect(r.made).toMatch(/^Highlighted in green: \[\[rich\.epub#cfi=/)
    expect(r.note).toMatch(
      /> \[!quote\|green\] \[\[rich\.epub#cfi=[^|]+\|Chapter 3\]\]\n> Chapter 3, part two\n>\n> Where the second half starts\./
    )
    // The words selected by hand are the highlight the agent made: same CFI.
    expect(r.active, JSON.stringify(r.diag)).toBeTruthy()
    expect(r.active).toBe(r.cfiMade)
    expect(r.listed).toMatch(/^1 highlight in Rich test book/)
    expect(r.edited).toMatch(/^Changed: purple/)
    expect(r.shown).toBe('purple')
    expect(r.removed).toMatch(/^Removed the purple highlight/)
    expect(r.left).toBe(0)
  })

  it('highlights words across two lines of a PDF page, drawn on the page and found by a hand selection', () => {
    const r = run<{
      error?: string
      made?: string
      note?: string
      boxes?: number
      active?: string | null
      cfi?: string
    }>(`
      for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
      const made = await call('book_highlight', { book: ${JSON.stringify(PDF)} + '#page=2', text: 'for the text layer. The quick brown', color: 'blue' })
      const note = await read(${JSON.stringify(PDF_NOTE)})
      const cfi = /#cfi=([^|\\]]+)/.exec(note)?.[1]
      const { leaf, view } = await open(${JSON.stringify(PDF)})
      await view.engine.goTo(1)
      const pageDocs = () => view.engine.renderer.getContents().map((c) => c.doc).filter(Boolean)
      const doc = await until(() => pageDocs().find((d) => d.querySelector('#canvas img') && d.querySelector('.textLayer')?.textContent.includes('Page 2')), 10000)
      const boxes = await until(() => doc?.querySelectorAll('.abele-marks__box').length, 5000)
      const layer = doc?.querySelector('.textLayer')
      const a = layer && textNode(doc, layer, 'for the text layer.')
      const b = layer && textNode(doc, layer, 'The quick brown')
      if (a && b) select(doc, a, a.nodeValue.indexOf('for the'), b, b.nodeValue.indexOf('The quick brown') + 'The quick brown'.length)
      const active = await until(() => view.model.active?.cfi, 3000)
      const made0 = view.model.highlights[0]?.cfi
      leaf.detach()
      return { made, note, boxes, active, cfi: made0 }
    `)
    expect(r.error).toBeUndefined()
    expect(r.made).toMatch(/^Highlighted in blue: \[\[plain\.pdf#cfi=/)
    expect(r.note).toMatch(
      /> \[!quote\|blue\] \[\[plain\.pdf#cfi=[^|]+\|Page 2\]\]\n> for the text layer\.\n> The quick brown/
    )
    expect(r.boxes).toBeGreaterThan(0)
    expect(r.active).toBe(r.cfi)
  })

  it('bookmarks a place and removes the bookmark by its id', () => {
    const r = run<{
      error?: string
      made?: string
      listed?: string
      removed?: string
      after?: string
    }>(`
      const search = await call('book_search', { book: ${JSON.stringify(BOOK)}, query: 'second note' })
      const link = firstLink(search, '1.')
      const made = await call('book_bookmark', { book: link })
      const listed = await call('book_highlights', { book: ${JSON.stringify(BOOK)} })
      const id = /^- (\\S+): /m.exec(listed)?.[1]
      const removed = await call('book_bookmark', { book: ${JSON.stringify(BOOK)}, remove: id })
      const after = await call('book_highlights', { book: ${JSON.stringify(BOOK)} })
      return { made, listed, removed, after }
    `)
    expect(r.error).toBeUndefined()
    expect(r.made).toMatch(/^Bookmarked \[\[rich\.epub#cfi=[^|]+\|Notes\]\] \(id \S+\)\.$/)
    expect(r.listed).toMatch(
      /Bookmarks: 1\n- \S+: \[\[rich\.epub#cfi=[^|]+\|Notes\]\] — second note, at the end of the book\./
    )
    expect(r.removed).toMatch(/^Removed the bookmark/)
    expect(r.after).not.toContain('Bookmarks:')
  })
})
