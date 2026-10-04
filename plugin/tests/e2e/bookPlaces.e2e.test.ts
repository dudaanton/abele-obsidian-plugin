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
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { shotDir } from './helpers/shots'
import { evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub, RICH_BOOK_ID } from '../fixtures/books/richBook'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { buildLongPdf } from '../fixtures/books/pdfFixture'
import { WAIT_PRELUDE } from './helpers/wait'

const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('book-places')
const DIR = 'Abele reader places e2e'
const BOOK = `${DIR}/rich.epub`
const RUN = Date.now().toString(36)
const PDF = `${DIR}/sample-pages-${RUN}.pdf`
const BOOK_ID = `urn:uuid:sample-reading-place-${RUN}`

// Fresh identities prevent an old fixture record from satisfying a new-write proof.
const freshBook = () => {
  const entries = unzipSync(buildRichEpub())
  entries['OEBPS/content.opf'] = strToU8(
    strFromU8(entries['OEBPS/content.opf']).replace(RICH_BOOK_ID, BOOK_ID)
  )
  return zipSync(entries)
}

const PRELUDE = `
  ${WAIT_PRELUDE}
  const placesFile = window.__abeleTest.AbeleConfig.getInstance().reader?.placesPath || 'abele-book-places.json'
  const saved = async () => JSON.parse(await app.vault.adapter.read(placesFile))
  const leafOf = (path) => app.workspace.getLeavesOfType('abele-book').find((l) => l.getViewState().state?.file === path)
  const ready = async (leaf) => {
    if (!leaf) throw new Error('reader tab is absent')
    await leaf.loadIfDeferred?.()
    if (!await until(() => {
      const v = leaf.view
      return v.model?.status === 'ready' && v.model.chapter && v.engine?.lastLocation?.cfi &&
        v.engine.renderer?.getContents().some(c => c.doc?.readyState === 'complete')
    })) throw new Error('reader did not become ready with a page and location')
    return leaf.view
  }
  const chapterAt = async (book, index) => {
    const href = book.model.toc[index].href
    await book.engine.goTo(href)
    if (!await until(() => book.model.currentHref === href && book.engine.lastLocation?.cfi))
      throw new Error('reader did not reach chapter ' + (index + 1))
  }
  // A later layout/anchor relocation may change the visible range without moving the saved
  // reading position. Match the independent reading event, not a mutable display CFI.
  const written = async (view, matches, wanted = observed.get(view)?.state.readingCfi) => {
    if (!wanted) throw new Error('no local reading CFI captured for ' + view.file.path)
    if (!await until(async () => Object.entries(await saved()).some(([key, place]) =>
      matches(key, place) && place.cfi === wanted)))
      throw new Error('reader place was not written: ' + JSON.stringify({ path: view.file.path, wanted, readingCfi: observed.get(view)?.state.readingCfi, currentCfi: view.engine.lastLocation?.cfi, record: Object.entries(await saved()).find(([key, place]) => matches(key, place)) }))
  }
`

// Readiness remains self-contained for its fast-tier contract; live-only recording is
// installed separately and removed after each probe.
const OBSERVATION = `
  const observed = new Map()
  const diagnostics = { configuredPath: window.__abeleTest.AbeleConfig.getInstance().reader?.placesPath, placesFile, events: [], warnings: [] }
  const originalWarn = console.warn
  console.warn = (...args) => {
    if (String(args[0]).includes('book places')) diagnostics.warnings.push(args.map(value => String(value?.stack || value)))
    originalWarn.apply(console, args)
  }
  const observe = view => {
    if (observed.has(view)) return
    const state = { path: view.file.path, readingCfi: null, readingReason: null }
    const handler = event => {
      const detail = event.detail
      diagnostics.events.push({ path: state.path, reason: detail.reason ?? null, cfi: detail.cfi, status: view.model.status })
      if (view.model.status === 'ready' && detail.reason !== 'anchor' && detail.cfi) {
        state.readingCfi = detail.cfi; state.readingReason = detail.reason ?? null
      }
    }
    view.engine.addEventListener('relocate', handler)
    observed.set(view, { state, handler })
  }
  const reportPlaces = async () => ({ ...diagnostics,
    disk: await saved().then(places => Object.fromEntries(Object.entries(places).filter(([key, place]) => key === 'id:' + ${JSON.stringify(BOOK_ID)} || place.path === ${JSON.stringify(PDF)})), error => ({ error: String(error) })),
    views: [...observed].map(([view, value]) => ({ ...value.state, currentCfi: view.engine?.lastLocation?.cfi })) })
  const capture = async name => {
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(${JSON.stringify(SHOTS + '/')} + name + '.png', image.toPNG())
  }
  const finishObservation = () => {
    for (const [view, value] of observed) view.engine?.removeEventListener('relocate', value.handler)
    console.warn = originalWarn
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE} ${OBSERVATION}
      try { const result = await (async () => { ${body} })(); return { ...result, diagnostics: await reportPlaces() } }
      catch (e) { return { error: String((e && e.stack) || e), diagnostics: await reportPlaces() } }
      finally { finishObservation() }
    })()`,
    90_000
  )

describe.skipIf(!available)('where a book was left, across a restart', () => {
  let before: {
    error?: string
    chapter?: string
    page?: string
    bookCfi?: string
    pdfCfi?: string
    bookReadingCfi?: string
    pdfReadingCfi?: string
  }

  beforeAll(async () => {
    const files = {
      'rich.epub': Buffer.from(freshBook()).toString('base64'),
      [PDF.split('/').at(-1)!]: Buffer.from(buildLongPdf(12)).toString('base64'),
    }
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book'))
          if (leaf.getViewState().state?.file?.startsWith(${JSON.stringify(DIR + '/')})) leaf.detach()
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
        try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
        await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
        const view = await ready(leaf)
        observe(view)
        return view
      }
      const book = await open(${JSON.stringify(BOOK)})
      await chapterAt(book, 2)
      const firstPage = book.engine.lastLocation.cfi
      await book.engine.renderer.next()
      if (!await until(() => book.engine.lastLocation?.cfi !== firstPage))
        throw new Error('reader did not turn the page')
      const chapter = book.model.chapter
      const bookReadingCfi = observed.get(book).state.readingCfi
      const pdf = await open(${JSON.stringify(PDF)})
      // A previous fixture run may have left this PDF on page 7 already. Make an actual
      // navigation before the wanted page, rather than accepting an unchanged old record.
      await pdf.engine.goTo(0)
      if (!await until(() => pdf.model.chapter?.startsWith('Page 1 of 12')))
        throw new Error('PDF did not reach the initial page')
      await pdf.engine.goTo(6)
      if (!await until(() => pdf.model.chapter?.startsWith('Page 7 of 12')))
        throw new Error('PDF did not reach page 7')
      const page = pdf.model.chapter
      const pdfReadingCfi = observed.get(pdf).state.readingCfi
      // Observe the debounced writes on disk, without flushing them on the test's behalf.
      await written(book, key => key === 'id:' + ${JSON.stringify(BOOK_ID)}, bookReadingCfi)
      await written(pdf, (_key, place) => place.path === ${JSON.stringify(PDF)}, pdfReadingCfi)
      app.workspace.requestSaveLayout()
      if (!await until(async () => {
        const layout = JSON.parse(await app.vault.adapter.read(app.vault.configDir + '/workspace.json'))
        const leaves = node => [node, ...(node.children || []).flatMap(leaves)]
        const tabs = leaves(layout.main)
        return layout.active === pdf.leaf.id && [book, pdf].every(view =>
          tabs.some(tab => tab.id === view.leaf.id && tab.state?.state?.file === view.file.path))
      })) throw new Error('book tabs were not saved in the workspace')
      const places = await saved()
      await capture('reading-places-before-reload')
      return {
        chapter, page, bookReadingCfi, pdfReadingCfi,
        bookCfi: places['id:' + ${JSON.stringify(BOOK_ID)}]?.cfi,
        pdfCfi: Object.entries(places).find(([k, v]) => v.path === ${JSON.stringify(PDF)})?.[1]?.cfi,
      }
    `)
    console.log('place persistence observation', JSON.stringify(before))
    writeFileSync(join(shotDir('book-places'), 'before.json'), JSON.stringify(before, null, 2))
    if (!before.error) {
      await reloadApp()
      evalRaw(
        `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`
      )
    }
  }, 180_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book'))
          if (leaf.getViewState().state?.file?.startsWith(${JSON.stringify(DIR + '/')})) leaf.detach()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        // The fixture vault holds nothing of the tests' own afterwards.
        const places = window.__abeleTest.AbeleConfig.getInstance().reader?.placesPath || 'abele-book-places.json'
        if (await app.vault.adapter.exists(places)) {
          const current = JSON.parse(await app.vault.adapter.read(places))
          const kept = Object.fromEntries(Object.entries(current).filter(([_key, place]) => !place.path?.startsWith(${JSON.stringify(DIR + '/')})))
          if (Object.keys(kept).length) await app.vault.adapter.write(places, JSON.stringify(kept))
          else await app.vault.adapter.remove(places)
        }
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
    expect(before.bookCfi).toBe(before.bookReadingCfi)
    expect(before.pdfCfi).toBe(before.pdfReadingCfi)
  })

  it('opens the restored tabs where they were left, and keeps the places', () => {
    expect(
      before.error,
      'the persistence baseline must succeed before testing reopen'
    ).toBeUndefined()
    expect(before.bookCfi).toBeTruthy()
    expect(before.pdfCfi).toBeTruthy()
    const r = run<{
      error?: string
      chapter?: string
      page?: string
      bookCfi?: string
      pdfCfi?: string
      readingAnchorVisible?: boolean
      pdfSection?: number
      expectedPdfSection?: number
    }>(`
      const bookLeaf = await until(() => leafOf(${JSON.stringify(BOOK)}), 15000)
      const pdfLeaf = await until(() => leafOf(${JSON.stringify(PDF)}), 15000)
      if (!bookLeaf || !pdfLeaf) return { error: 'the tabs were not restored' }
      app.workspace.setActiveLeaf(bookLeaf, { focus: true })
      const book = await ready(bookLeaf)
      observe(book)
      const resolved = book.engine.resolveNavigation(${JSON.stringify(before.bookCfi)})
      const content = book.engine.renderer.getContents().find(item => item.index === resolved?.index)
      const anchor = content && resolved?.anchor?.(content.doc)
      const visible = book.engine.lastLocation?.range
      const readingAnchorVisible = !!anchor && !!visible && visible.comparePoint(anchor.startContainer, anchor.startOffset) === 0
      await capture('restored-reading-anchor')
      app.workspace.setActiveLeaf(pdfLeaf, { focus: true })
      const pdf = await ready(pdfLeaf)
      observe(pdf)
      // Observation window: restoration must not overwrite either saved place later.
      await wait(2500)
      const places = await saved()
      return {
        chapter: book.model.chapter,
        readingAnchorVisible,
        page: pdf.model.chapter,
        pdfSection: pdf.engine.lastLocation?.section?.current,
        expectedPdfSection: pdf.engine.resolveNavigation(${JSON.stringify(before.pdfCfi)})?.index,
        bookCfi: places['id:' + ${JSON.stringify(BOOK_ID)}]?.cfi,
        pdfCfi: Object.entries(places).find(([k, v]) => v.path === ${JSON.stringify(PDF)})?.[1]?.cfi,
      }
    `)
    expect(r.error).toBeUndefined()
    expect(r.chapter).toBe(before.chapter)
    expect(r.page).toBe(before.page)
    expect(r.bookCfi).toBe(before.bookCfi)
    expect(r.pdfCfi).toBe(before.pdfCfi)
    expect(r.readingAnchorVisible).toBe(true)
    expect(r.pdfSection).toBe(r.expectedPdfSection)
    console.log('reopened reading places', JSON.stringify(r))
    writeFileSync(join(shotDir('book-places'), 'reopened.json'), JSON.stringify(r, null, 2))
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
      observe(book)
      // Keep the activation dwell: looked-again resets the reading clock after its layout
      // debounce, with no public completion signal. The turns below must happen afterwards.
      await wait(800)
      const key = 'id:' + ${JSON.stringify(BOOK_ID)}
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
      await chapterAt(book, 0)
      const first = book.engine.lastLocation.cfi
      await chapterAt(book, 1)
      const second = book.engine.lastLocation.cfi
      const nextWant = book.model.chapter
      // Read here just now: what arrives waits, and nothing is said.
      await chapterAt(book, 2)
      await written(book, savedKey => savedKey === key)
      await arrive(first)
      // Observation window: an incoming place must not interrupt current reading.
      await wait(3000)
      const stayed = book.model.chapter
      // Another tab, then this one again: it goes where the other device got to, and says so.
      app.workspace.setActiveLeaf(pdfLeaf, { focus: true }); await wait(300)
      app.workspace.setActiveLeaf(bookLeaf, { focus: true })
      await until(() => book.model.chapter?.startsWith('Chapter 1'), 15000)
      const followed = book.model.chapter
      // The follow operation announces completion after navigating, not just relocating.
      if (!await until(() => told.size === 1)) throw new Error('follow notice did not appear')
      // Not read here since: the next place follows at once, without another notice.
      await arrive(second)
      await until(() => book.model.chapter === nextWant, 15000)
      const next = book.model.chapter
      // Observation window: no duplicate notice or debounced echo of the followed place.
      await wait(2500)
      seen.disconnect()
      // Followed, not read: the other device's place stays in the file, not this tab's echo.
      const kept = (await saved())[key]?.cfi === second ? 'yes' : 'no'
      return { stayed, followed, next, nextWant, notices: told.size, kept }
    `)
    console.log('remote place follow', JSON.stringify(r))
    writeFileSync(join(SHOTS, 'remote-follow.json'), JSON.stringify(r, null, 2))
    expect(r.error).toBeUndefined()
    expect(r.stayed).not.toMatch(/^Chapter 1/)
    expect(r.followed).toMatch(/^Chapter 1/)
    expect(r.next).toBe(r.nextWant)
    expect(r.notices).toBe(1)
    expect(r.kept).toBe('yes')
  })
})
