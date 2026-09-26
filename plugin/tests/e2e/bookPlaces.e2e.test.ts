/**
 * Where a book was left, across a restart of the app: a book and a PDF are read to a place, the
 * app's window is reloaded with their tabs open, and the tabs Obsidian restores open them where
 * they were — and the file of places, in the vault, still holds those places afterwards. Then
 * another device's later places arrive in that file, written on disk as a sync would: the open
 * book, read just now, waits; looked at again it follows them, and says so once.
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

  it('waits while read here, follows another device once looked at again, and says so once', () => {
    const r = run<{
      error?: string
      stayed?: string
      followed?: string
      next?: string
      nextWant?: string
      notices?: number
      kept?: string
    }>(`
      const bookLeaf = await until(() => leafOf(${JSON.stringify(BOOK)}), 15000)
      const pdfLeaf = await until(() => leafOf(${JSON.stringify(PDF)}), 15000)
      // In front: the tab before showed the PDF.
      app.workspace.setActiveLeaf(bookLeaf, { focus: true })
      const book = await ready(bookLeaf)
      const key = 'id:' + ${JSON.stringify(RICH_BOOK_ID)}
      const full = require('path').join(app.vault.adapter.getBasePath(), placesFile)
      // Another device's place arriving as a sync writes it: on disk, beside the app.
      const arrive = async (cfi) => {
        const places = await saved()
        places[key] = { ...places[key], cfi, at: Date.now() }
        require('fs').writeFileSync(full, JSON.stringify(places))
      }
      // Each notice once: it can be heard both as itself and inside its container.
      const told = new Set()
      const seen = new MutationObserver((changes) => {
        for (const c of changes) for (const n of c.addedNodes) {
          if (n.nodeType !== 1) continue
          for (const el of [n, ...n.querySelectorAll('.notice')])
            if (el.classList.contains('notice') && /another device/.test(el.textContent)) told.add(el)
        }
      })
      seen.observe(document.body, { childList: true, subtree: true })
      await book.engine.goTo(book.model.toc[0].href); await wait(600)
      const first = book.engine.lastLocation.cfi
      await book.engine.goTo(book.model.toc[1].href); await wait(600)
      const second = book.engine.lastLocation.cfi
      const nextWant = book.model.chapter
      // Read here just now: what arrives waits, and nothing is said.
      await book.engine.goTo(book.model.toc[2].href); await wait(2500)
      await arrive(first)
      await wait(3000)
      const stayed = book.model.chapter
      // Another tab, then this one again: it goes where the other device got to, and says so.
      app.workspace.setActiveLeaf(pdfLeaf, { focus: true }); await wait(300)
      app.workspace.setActiveLeaf(bookLeaf, { focus: true })
      await until(() => book.model.chapter?.startsWith('Chapter 1'), 15000)
      const followed = book.model.chapter
      // Not read here since: the next place follows at once, without another notice.
      await wait(300)
      await arrive(second)
      await until(() => book.model.chapter === nextWant, 15000)
      const next = book.model.chapter
      await wait(2500)
      seen.disconnect()
      // Followed, not read: the other device's place stays in the file, not this tab's echo.
      const kept = (await saved())[key]?.cfi === second ? 'yes' : 'no'
      return { stayed, followed, next, nextWant, notices: told.size, kept }
    `)
    expect(r.error).toBeUndefined()
    expect(r.stayed).not.toMatch(/^Chapter 1/)
    expect(r.followed).toMatch(/^Chapter 1/)
    expect(r.next).toBe(r.nextWant)
    expect(r.notices).toBe(1)
    expect(r.kept).toBe('yes')
  })
})
