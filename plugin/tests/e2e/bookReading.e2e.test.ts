/**
 * Reading a book in the running app: notes, links, contents, where the book was left, and the
 * text and layout settings, on the desktop. The book is `tests/fixtures/books/richBook.ts`,
 * written to the vault for the run and removed after it; the settings are put back as they were.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader reading e2e'
const BOOK = `${DIR}/rich.epub`
const RENAMED = `${DIR}/moved/renamed.epub`

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const open = async (path) => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(app.vault.getAbstractFileByPath(path))
    const view = leaf.view
    await until(() => view.model?.status === 'ready')
    await wait(800)
    return { leaf, view }
  }
  const pageDoc = (view) => view.engine.renderer.getContents()[0].doc
  const escape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

describe.skipIf(!available)('reading a book', () => {
  beforeAll(() => {
    const data = Buffer.from(buildRichEpub()).toString('base64')
    evalRaw(
      `(async () => {
        window.__abeleReaderSaved = { ...window.__abeleTest.AbeleConfig.getInstance().reader }
        for (const p of [${JSON.stringify(DIR)}, ${JSON.stringify(`${DIR}/moved`)}])
          if (!app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p)
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(BOOK)})
        if (old) await app.vault.modifyBinary(old, bytes.buffer)
        else await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        if (window.__abeleReaderSaved) { cfg.reader = window.__abeleReaderSaved; await cfg.saveSettings() }
        delete window.__abeleReaderSaved
        document.body.classList.toggle('theme-dark', false)
        document.body.classList.toggle('theme-light', true)
        app.workspace.trigger('css-change')
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('opens a note in a dialog over the page, whether marked as a note or only by a superscript', () => {
    const r = run<{
      error?: string
      first?: { type: string | null; text: string; inDialog: boolean; findings: string[] }
      second?: { type: string | null; text: string }
      closed?: boolean
    }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      const read = async () => {
        await until(() => view.model.footnote, 5000)
        const note = view.model.footnote?.view
        const doc = await until(() => note?.renderer?.getContents?.()?.[0]?.doc?.body?.innerText?.trim() && note.renderer.getContents()[0].doc, 5000)
        await wait(300)
        return { type: view.model.footnote?.type ?? null, text: doc?.body?.innerText?.trim() ?? '', inDialog: !!note?.closest('.modal'), findings: view.pages.flatMap((p) => p.findings) }
      }
      pageDoc(view).getElementById('ref1').click()
      const first = await read()
      escape()
      await wait(400)
      const closed = !view.model.footnote
      pageDoc(view).getElementById('ref2').click()
      const second = await read()
      escape()
      leaf.detach()
      return { first, second, closed }
    `)
    expect(r.error).toBeUndefined()
    expect(r.first).toEqual({
      type: 'footnote',
      text: 'The first note, from the same chapter.',
      inDialog: true,
      findings: [],
    })
    expect(r.closed).toBe(true)
    expect(r.second?.text).toContain('The second note, at the end of the book.')
  })

  it('follows a link to another chapter and offers the way back', () => {
    const r = run<{ error?: string; after?: string; back?: boolean; returned?: string }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(view.model.toc[0].href)
      await wait(800)
      pageDoc(view).getElementById('to-three').click()
      await until(() => view.model.chapter === 'Chapter 3', 5000)
      const after = view.model.chapter
      const back = view.model.canGoBack
      view.contentEl.querySelector('.abele-book-reader__footer .abele-obsidian-icon').click()
      await until(() => view.model.chapter === 'Chapter 1', 5000)
      const returned = view.model.chapter
      leaf.detach()
      return { after, back, returned }
    `)
    expect(r.error).toBeUndefined()
    expect(r).toMatchObject({ after: 'Chapter 3', back: true, returned: 'Chapter 1' })
  })

  it('shows the contents beside the page and goes to a chapter picked there', () => {
    const r = run<{ error?: string; rows?: string[]; beside?: boolean; chapter?: string }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      view.model.panel = true
      await wait(500)
      const panel = view.contentEl.querySelector('.abele-book-reader__panel').getBoundingClientRect()
      const stage = view.contentEl.querySelector('.abele-book-reader__stage').getBoundingClientRect()
      const rows = [...view.contentEl.querySelectorAll('.abele-book-contents .tree-item-self')].map((el) => el.textContent.trim())
      ;[...view.contentEl.querySelectorAll('.abele-book-contents .tree-item-self')].find((el) => el.textContent.trim() === 'Chapter 3').click()
      await until(() => view.model.chapter === 'Chapter 3', 5000)
      const chapter = view.model.chapter
      view.model.panel = false
      leaf.detach()
      return { rows, beside: panel.right <= stage.left + 1, chapter }
    `)
    expect(r.error).toBeUndefined()
    expect(r.rows).toEqual(expect.arrayContaining(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Notes']))
    expect(r.beside).toBe(true)
    expect(r.chapter).toBe('Chapter 3')
  })

  it('opens where it was left, also after the file is renamed and moved', () => {
    const r = run<{ error?: string; left?: string; reopened?: string; moved?: string }>(`
      let { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(view.model.toc[1].children[0].href)
      await wait(1000)
      const left = view.model.chapter
      leaf.detach()
      await wait(300)
      ;({ leaf, view } = await open(${JSON.stringify(BOOK)}))
      const reopened = view.model.chapter
      leaf.detach()
      await app.fileManager.renameFile(app.vault.getAbstractFileByPath(${JSON.stringify(BOOK)}), ${JSON.stringify(RENAMED)})
      ;({ leaf, view } = await open(${JSON.stringify(RENAMED)}))
      const moved = view.model.chapter
      leaf.detach()
      await app.fileManager.renameFile(app.vault.getAbstractFileByPath(${JSON.stringify(RENAMED)}), ${JSON.stringify(BOOK)})
      return { left, reopened, moved }
    `)
    expect(r.error).toBeUndefined()
    expect(r.left).toBe('Chapter 2, part two')
    expect(r.reopened).toBe(r.left)
    expect(r.moved).toBe(r.left)
  })

  it('redraws the page as the text and layout settings change, and in a dark theme', () => {
    const r = run<{
      error?: string
      flow?: string | null
      size?: string
      family?: string
      columns?: string | null
      dark?: { color: string; scheme: string; theme: string }
    }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      cfg.reader = { ...cfg.reader, flow: 'scrolled', fontSize: 150, font: 'serif', columns: 1 }
      await cfg.saveSettings()
      await wait(1200)
      const doc = pageDoc(view)
      const p = doc.querySelector('p')
      const renderer = view.engine.renderer
      const out = {
        flow: renderer.getAttribute('flow'),
        size: getComputedStyle(p).fontSize,
        family: getComputedStyle(p).fontFamily,
        columns: renderer.getAttribute('max-column-count'),
      }
      document.body.classList.toggle('theme-light', false)
      document.body.classList.toggle('theme-dark', true)
      app.workspace.trigger('css-change')
      await wait(1000)
      const theme = getComputedStyle(view.contentEl).getPropertyValue('--text-normal').trim()
      const probe = document.createElement('span')
      probe.style.color = theme
      document.body.appendChild(probe)
      out.dark = { color: getComputedStyle(pageDoc(view).querySelector('p')).color, scheme: getComputedStyle(pageDoc(view).documentElement).colorScheme, theme: getComputedStyle(probe).color }
      probe.remove()
      document.body.classList.toggle('theme-dark', false)
      document.body.classList.toggle('theme-light', true)
      app.workspace.trigger('css-change')
      cfg.reader = { ...window.__abeleReaderSaved }
      await cfg.saveSettings()
      leaf.detach()
      return out
    `)
    expect(r.error).toBeUndefined()
    expect(r.flow).toBe('scrolled')
    expect(r.columns).toBe('1')
    // 150% of the 16px a page starts from.
    expect(r.size).toBe('24px')
    expect(r.family).toMatch(/Charter|Georgia|serif/)
    expect(r.dark?.scheme).toBe('dark')
    expect(r.dark?.color).toBe(r.dark?.theme)
  })
})
