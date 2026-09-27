/**
 * A note opened from a book that was not open before — the highlights note from "Open the note",
 * a note linking into the book from a tap on its words — in the running app: it comes up at the
 * line, flashed, in reading view and in the editor. It is the case a person meets most, and the
 * one where the note is still being loaded when it is asked to show the line; a note read before
 * comes back at the place it was left, which must not win over the line asked for.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader note flash e2e'
const BOOK = `${DIR}/rich.epub`
const CARD = `${DIR}/card.md`
const PLACE = '/6/6!/4/2%5Bc3%5D,/1:0,/1:7'

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const filler = Array.from({ length: 120 }, (_, i) => 'Paragraph ' + (i + 1) + ' of my own notes.').join('\\n\\n')
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
  /** Where the flashed blocks of the note's only tab are, against what its scroller shows. */
  const seen = (path, text) => {
    const nv = notesOf(path)[0]?.view
    if (!nv) return { open: false }
    const preview = nv.getMode() === 'preview'
    const scroller = nv.containerEl.querySelector(preview ? '.markdown-reading-view .markdown-preview-view' : '.cm-scroller')
    const s = scroller.getBoundingClientRect()
    const els = [...nv.containerEl.querySelectorAll('.abele-line-flash')]
    const inView = els.filter((el) => { const b = el.getBoundingClientRect(); return b.bottom > s.top && b.top < s.bottom })
    return { open: true, flashed: els.length, inView: inView.length, holds: inView.some((el) => el.textContent.includes(text)) }
  }
  /** The note opened before, scrolled to its end, and closed: it will come back there. */
  const readAndClose = async (path) => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(app.vault.getAbstractFileByPath(path), { active: true })
    await wait(600)
    const v = leaf.view
    if (v.getMode() === 'preview') v.previewMode.applyScroll(10000)
    else v.editor.scrollTo(0, 100000)
    await wait(600)
    leaf.detach()
    await wait(300)
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      const mode = app.vault.getConfig('defaultViewMode')
      try { return await (async () => { ${body} })() } catch (e) { return { error: String((e && e.stack) || e) } }
      finally {
        app.vault.setConfig('defaultViewMode', mode)
        for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
        for (const l of app.workspace.getLeavesOfType('markdown'))
          if (l.view.file?.path.startsWith(${JSON.stringify(DIR)})) l.detach()
      }
    })()`,
    90_000
  )

interface Seen {
  open: boolean
  flashed?: number
  inView?: number
  holds?: boolean
}

describe.skipIf(!available)('a note not open, opened at a line from a book', () => {
  beforeAll(() => {
    const epub = Buffer.from(buildRichEpub()).toString('base64')
    evalRaw(
      `(async () => {
        ${PRELUDE}
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(epub)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        await app.vault.create(${JSON.stringify(CARD)}, filler + '\\n\\nThe card links [[rich.epub#cfi=${PLACE}|here]].\\n\\n' + filler + '\\n')
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

  it('the highlights note, from "Open the note", flashed on screen in both modes', () => {
    const r = run<{ error?: string; out?: Record<string, Seen> }>(`
      const { view } = await openBook()
      await view.engine.goTo(2)
      await wait(600)
      const h1 = pageDoc(view).querySelector('h1')
      const range = h1.ownerDocument.createRange()
      range.setStart(h1.firstChild, 0)
      range.setEnd(h1.firstChild, 7)
      h1.ownerDocument.getSelection().removeAllRanges()
      h1.ownerDocument.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      const h = await view.reading.highlight('yellow')
      if (!h) throw new Error('no highlight made')
      const path = await until(() => view.reading.notes()[0]?.path, 5000)
      const note = app.vault.getAbstractFileByPath(path)
      // Far down the note, below the place it was last left at.
      await app.vault.process(note, (md) => md.replace('\\n---\\n', '\\n---\\n\\n' + filler + '\\n\\n'))
      await wait(500)
      const out = {}
      for (const m of ['preview', 'source']) {
        app.vault.setConfig('defaultViewMode', m)
        for (const before of ['never', 'read']) {
          if (before === 'read') await readAndClose(path)
          await view.reading.openNote(h)
          await wait(500)
          out[m + ':' + before] = seen(path, 'Chapter')
          for (const l of notesOf(path)) l.detach()
          await wait(300)
        }
      }
      return { out }
    `)
    expect(r.error).toBeUndefined()
    for (const [k, s] of Object.entries(r.out!)) {
      expect(s.open, k).toBe(true)
      expect(s.inView, k).toBeGreaterThan(0)
      expect(s.holds, k).toBe(true)
    }
  })

  it('a note linking to the words, from a tap on them, flashed on screen in both modes', () => {
    const r = run<{ error?: string; out?: Record<string, Seen> }>(`
      const { view } = await openBook()
      await view.engine.goTo(2)
      await wait(600)
      const out = {}
      for (const m of ['preview', 'source']) {
        app.vault.setConfig('defaultViewMode', m)
        for (const before of ['never', 'read']) {
          if (before === 'read') await readAndClose(${JSON.stringify(CARD)})
          view.reading.marks.onLink(decodeURIComponent(${JSON.stringify(PLACE)}).replace(/^/, 'epubcfi(') + ')', { x: 10, y: 10 })
          await until(() => notesOf(${JSON.stringify(CARD)}).length, 5000)
          await wait(1500)
          out[m + ':' + before] = seen(${JSON.stringify(CARD)}, 'The card links')
          for (const l of notesOf(${JSON.stringify(CARD)})) l.detach()
          await wait(300)
        }
      }
      return { out }
    `)
    expect(r.error).toBeUndefined()
    for (const [k, s] of Object.entries(r.out!)) {
      expect(s.open, k).toBe(true)
      expect(s.inView, k).toBeGreaterThan(0)
      expect(s.holds, k).toBe(true)
    }
  })
})
