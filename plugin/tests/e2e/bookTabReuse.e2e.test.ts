/**
 * A link followed to a book or a note already open in a tab, in the running app: that tab comes
 * forward and goes to the place, rather than the file opening in another tab.
 *
 * - A link to words in a book, clicked twice in a note, leaves one book tab — in front, at the
 *   words, selected — and the note where it was. A Mod-click opens a second one, as asked.
 * - The highlights note opened twice from the book leaves one note tab, in front, the highlight
 *   flashed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader tab reuse e2e'
const BOOK = `${DIR}/rich.epub`
const LINKS = `${DIR}/links.md`
const LINK = 'rich.epub#cfi=/6/6!/4/2%5Bc3%5D,/1:0,/1:7'

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const books = () => app.workspace.getLeavesOfType('abele-book')
  const notesOf = (path) => app.workspace.getLeavesOfType('markdown').filter((l) => l.view.file?.path === path)
  const pageDoc = (view) => view.engine.renderer.getContents()[0]?.doc
  const openBook = async () => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready', 15000)
    await wait(600)
    return { leaf, view }
  }
  const clear = () => {
    for (const l of books()) l.detach()
    for (const l of app.workspace.getLeavesOfType('markdown'))
      if (l.view.file?.path.startsWith(${JSON.stringify(DIR)})) l.detach()
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { return await (async () => { ${body} })() } catch (e) { return { error: String((e && e.stack) || e) } }
      finally { clear() }
    })()`,
    60_000
  )

describe.skipIf(!available)('a link to a file already open in a tab', () => {
  beforeAll(() => {
    const epub = Buffer.from(buildRichEpub()).toString('base64')
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(epub)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        await app.vault.create(${JSON.stringify(LINKS)}, 'See [[${LINK}|Chapter 3]] here.\\n')
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  afterAll(() => {
    if (!available) return
    evalRaw(
      `(async () => {
        for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  it('goes to the words in the book’s own tab, twice, and a Mod-click opens another', () => {
    type Seen = {
      books: number
      front: boolean
      selected: string
      chapter: string
      noteKept: boolean
    }
    const r = run<{ error?: string; clicks?: Seen[]; withMod?: number }>(`
      const { leaf: bookLeaf, view } = await openBook()
      const noteLeaf = app.workspace.getLeaf('tab')
      await noteLeaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(LINKS)}), { state: { mode: 'preview' } })
      const clicks = []
      const click = async (mod) => {
        app.workspace.setActiveLeaf(noteLeaf, { focus: true })
        await app.workspace.revealLeaf(noteLeaf)
        // The book elsewhere, so arriving at the words is seen.
        await view.engine.goTo(0)
        pageDoc(view)?.getSelection()?.removeAllRanges()
        await wait(400)
        const a = await until(() => noteLeaf.view.containerEl.querySelector('.markdown-reading-view a.internal-link[data-href*="cfi="]'), 8000)
        if (!a) throw new Error('no link in the note')
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: mod, ctrlKey: mod }))
        await wait(300)
      }
      for (let i = 0; i < 2; i++) {
        await click(false)
        await until(() => pageDoc(view)?.getSelection()?.toString(), 6000)
        clicks.push({
          books: books().length,
          front: app.workspace.activeLeaf === bookLeaf,
          selected: pageDoc(view)?.getSelection()?.toString() ?? '',
          chapter: view.model.chapter,
          noteKept: noteLeaf.view.file?.path === ${JSON.stringify(LINKS)},
        })
      }
      await click(true)
      await until(() => books().length === 2, 5000)
      return { clicks, withMod: books().length }
    `)
    expect(r.error).toBeUndefined()
    expect(r.clicks).toHaveLength(2)
    for (const seen of r.clicks!)
      expect(seen).toEqual({
        books: 1,
        front: true,
        selected: 'Chapter',
        chapter: 'Chapter 3',
        noteKept: true,
      })
    expect(r.withMod).toBe(2)
  })

  it('opens the highlights note in its own tab, twice, the highlight flashed', () => {
    type Seen = { notes: number; front: boolean; flashed: number }
    const r = run<{ error?: string; opens?: Seen[]; withMod?: number }>(`
      const { leaf: bookLeaf, view } = await openBook()
      await view.engine.goTo(2)
      await wait(600)
      const h1 = pageDoc(view).querySelector('h1')
      const doc = h1.ownerDocument
      const range = doc.createRange()
      range.setStart(h1.firstChild, 0)
      range.setEnd(h1.firstChild, 7)
      doc.getSelection().removeAllRanges()
      doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      const h = await view.reading.highlight('yellow')
      if (!h) throw new Error('no highlight made')
      await until(() => view.model.highlights.length > 0, 8000)
      const path = view.reading.notes()[0]?.path
      if (!path) throw new Error('no highlights note')
      const opens = []
      for (let i = 0; i < 2; i++) {
        app.workspace.setActiveLeaf(bookLeaf, { focus: true })
        await app.workspace.revealLeaf(bookLeaf)
        await wait(300)
        await view.reading.openNote(h)
        const leaf = notesOf(path)[0]
        const flashed = await until(() => leaf?.view.containerEl.querySelectorAll('.abele-line-flash').length, 3000)
        opens.push({ notes: notesOf(path).length, front: app.workspace.activeLeaf === leaf, flashed: flashed ?? 0 })
      }
      await view.reading.openNote(h, 'tab')
      return { opens, withMod: notesOf(path).length }
    `)
    expect(r.error).toBeUndefined()
    expect(r.opens).toHaveLength(2)
    for (const seen of r.opens!) {
      expect(seen.notes).toBe(1)
      expect(seen.front).toBe(true)
      expect(seen.flashed).toBeGreaterThan(0)
    }
    expect(r.withMod).toBe(2)
  })
})
