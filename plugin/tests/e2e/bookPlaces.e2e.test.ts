/**
 * Where a book was left, across a restart of the app: a book and a PDF are read to a place, the
 * app's window is reloaded with their tabs open, and the tabs Obsidian restores open them where
 * they were — and the file of places, in the vault, still holds those places afterwards. Then
 * another device's later place arrives in that file, written on disk as a sync would, and the
 * open book follows it.
 *
 * A full quit and relaunch of the app was checked by hand the same way; a phone stopping the app
 * in the background is covered by the unit tests (`tests/unit/bookPlaces.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub, RICH_BOOK_ID } from '../fixtures/books/richBook'
import { buildLongPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader places e2e'
const BOOK = `${DIR}/rich.epub`
const PDF = `${DIR}/long.pdf`

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const placesFile = window.__abeleTest.AbeleConfig.getInstance().reader?.placesPath || 'abele-book-places.json'
  const saved = async () => JSON.parse(await app.vault.adapter.read(placesFile))
  const leafOf = (path) => app.workspace.getLeavesOfType('abele-book').find((l) => l.getViewState().state?.file === path)
  const ready = async (leaf) => {
    await leaf.loadIfDeferred?.()
    await until(() => leaf.view.model?.status === 'ready', 15000)
    await wait(800)
    return leaf.view
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    90_000
  )

describe.skipIf(!available)('where a book was left, across a restart', () => {
  let before: { error?: string; chapter?: string; page?: string; bookCfi?: string; pdfCfi?: string }

  beforeAll(async () => {
    const files = {
      'rich.epub': Buffer.from(buildRichEpub()).toString('base64'),
      'long.pdf': Buffer.from(buildLongPdf(12)).toString('base64'),
    }
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        return 'ok'
      })()`,
      60_000
    )
    // Read to a place in each, and left there with both tabs open.
    before = run(`
      const open = async (path) => {
        let leaf
        try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
        await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
        return ready(leaf)
      }
      const book = await open(${JSON.stringify(BOOK)})
      await book.engine.goTo(book.model.toc[2].href); await wait(600)
      await book.engine.renderer.next(); await wait(600)
      const chapter = book.model.chapter
      const pdf = await open(${JSON.stringify(PDF)})
      await pdf.engine.goTo(6); await wait(1200)
      const page = pdf.model.chapter
      // The place is written a moment after the last turn.
      await wait(2500)
      app.workspace.requestSaveLayout()
      await wait(2500)
      const places = await saved()
      return {
        chapter, page,
        bookCfi: places['id:' + ${JSON.stringify(RICH_BOOK_ID)}]?.cfi,
        pdfCfi: Object.entries(places).find(([k, v]) => v.path === ${JSON.stringify(PDF)})?.[1]?.cfi,
      }
    `)
    evalRaw(`(() => { setTimeout(() => window.location.reload(), 50); return 'ok' })()`, 30_000)
    await pause(4000)
    const deadline = Date.now() + 60_000
    while (!hasTestApi() && Date.now() < deadline) await pause(1000)
    evalRaw(
      `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`
    )
  }, 180_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        // The fixture vault holds nothing of the tests' own afterwards.
        const places = window.__abeleTest.AbeleConfig.getInstance().reader?.placesPath || 'abele-book-places.json'
        if (await app.vault.adapter.exists(places)) await app.vault.adapter.remove(places)
        return 'ok'
      })()`,
      60_000
    )
  }, 60_000)

  it('was read to a place in both, and the places were written', () => {
    expect(before.error).toBeUndefined()
    expect(before.chapter).toMatch(/^Chapter 3/)
    expect(before.page).toMatch(/^Page 7 of 12/)
    expect(before.bookCfi).toMatch(/^epubcfi\(\/6\/6!/)
    expect(before.pdfCfi).toBeTruthy()
  })

  it('opens the restored tabs where they were left, and keeps the places', () => {
    const r = run<{
      error?: string
      chapter?: string
      page?: string
      bookCfi?: string
      pdfCfi?: string
    }>(`
      const bookLeaf = await until(() => leafOf(${JSON.stringify(BOOK)}), 15000)
      const pdfLeaf = await until(() => leafOf(${JSON.stringify(PDF)}), 15000)
      if (!bookLeaf || !pdfLeaf) return { error: 'the tabs were not restored' }
      app.workspace.setActiveLeaf(bookLeaf, { focus: true })
      const book = await ready(bookLeaf)
      app.workspace.setActiveLeaf(pdfLeaf, { focus: true })
      const pdf = await ready(pdfLeaf)
      await wait(2500)
      const places = await saved()
      return {
        chapter: book.model.chapter,
        page: pdf.model.chapter,
        bookCfi: places['id:' + ${JSON.stringify(RICH_BOOK_ID)}]?.cfi,
        pdfCfi: Object.entries(places).find(([k, v]) => v.path === ${JSON.stringify(PDF)})?.[1]?.cfi,
      }
    `)
    expect(r.error).toBeUndefined()
    expect(r.chapter).toBe(before.chapter)
    expect(r.page).toBe(before.page)
    expect(r.bookCfi).toBe(before.bookCfi)
    expect(r.pdfCfi).toBe(before.pdfCfi)
  })

  it('follows a later place another device wrote into the file, and never writes an older one over it', () => {
    const r = run<{ error?: string; chapter?: string; kept?: string; told?: boolean }>(`
      const bookLeaf = await until(() => leafOf(${JSON.stringify(BOOK)}), 15000)
      // In front: the tab before showed the PDF.
      app.workspace.setActiveLeaf(bookLeaf, { focus: true })
      const book = await ready(bookLeaf)
      const key = 'id:' + ${JSON.stringify(RICH_BOOK_ID)}
      // The start of chapter 1, read on another device just now, arriving as a sync
      // writes it: on disk, beside the app.
      await book.engine.goTo(book.model.toc[0].href); await wait(600)
      const there = book.engine.lastLocation.cfi
      await book.engine.goTo(book.model.toc[2].href); await wait(2500)
      const places = await saved()
      places[key] = { ...places[key], cfi: there, at: Date.now() }
      const full = require('path').join(app.vault.adapter.getBasePath(), placesFile)
      require('fs').writeFileSync(full, JSON.stringify(places))
      await until(() => book.model.chapter?.startsWith('Chapter 1'), 15000)
      const told = [...document.querySelectorAll('.notice')].some((n) => /another device/.test(n.textContent))
      await wait(2500)
      return { chapter: book.model.chapter, kept: (await saved())[key]?.cfi === there ? 'yes' : 'no', told }
    `)
    expect(r.error).toBeUndefined()
    expect(r.chapter).toMatch(/^Chapter 1/)
    expect(r.told).toBe(true)
    expect(r.kept).toBe('yes')
  })
})
