import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { onPhone, targets } from './helpers/target'
import { screenshot, tap } from './helpers/phone'
import { buildVocabPdf } from '../fixtures/books/pdfFixture'

targets('desktop', 'phone')

const DIR = 'Abele pdf vocabulary e2e'
const BOOK = `${DIR}/sample-book.pdf`
const CARD = `${DIR}/sample-note.md`
const SHOTS = process.env.ABELE_PHONE_SHOTS ?? '/tmp/abele-iphone'
const available = isObsidianRunning() && hasTestApi()
let originalReader: Record<string, unknown> | null = null

const run = <T>(script: string): T =>
  evalAsync<T>(
    `(async () => {
  const until = async (fn) => { for (let i = 0; i < 120; i++) {
    const value = fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100))
  } return null }
  try { ${script} } catch (e) { return { error: String(e.stack || e) } }
})()`,
    60_000
  )

describe.skipIf(!available)('vocabulary on selectable PDF pages', () => {
  beforeAll(() => {
    originalReader = evalJson<Record<string, unknown>>(
      'window.__abeleTest.AbeleConfig.getInstance().reader'
    )
    const bytes = Buffer.from(buildVocabPdf()).toString('base64')
    evalRaw(
      `(async () => {
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      cfg.reader = { ...cfg.reader, pdfLayout: 'paginated', notesTo: 'book' }
      await cfg.saveSettings()
      if (!app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) await app.vault.createFolder(${JSON.stringify(DIR)})
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(BOOK)})
      if (old) await app.vault.delete(old, true)
      const data = Uint8Array.from(atob(${JSON.stringify(bytes)}), c => c.charCodeAt(0))
      await app.vault.createBinary(${JSON.stringify(BOOK)}, data.buffer)
      const card = app.vault.getAbstractFileByPath(${JSON.stringify(CARD)})
      if (card) await app.vault.delete(card, true)
      await app.vault.create(${JSON.stringify(CARD)}, '---\\nword-forms: [sample]\\nword-books: ["[[${BOOK}]]"]\\n---\\n\\nA sample entry.\\n')
      return 'ok'
    })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
      for (const leaf of app.workspace.getLeavesOfType('abele-book'))
        if (leaf.view?.file?.path === ${JSON.stringify(BOOK)}) leaf.detach()
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view?.file?.path === ${JSON.stringify(CARD)}) leaf.detach()
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      if (${originalReader !== null}) {
        cfg.reader = ${JSON.stringify(originalReader)}
        await cfg.saveSettings()
      }
      const folder = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (folder) await app.vault.delete(folder, true)
      return 'ok'
    })()`,
      60_000
    )
    if (originalReader) {
      expect(
        evalJson<Record<string, unknown>>('window.__abeleTest.AbeleConfig.getInstance().reader')
      ).toEqual(originalReader)
    }
  }, 90_000)

  it('marks a repeat on each drawn page and opens the existing card on a click', () => {
    const result = run<{
      error?: string
      first?: number
      second?: number
      opened?: string
      split?: boolean
    }>(`
      let leaf; try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
      await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
      const view = leaf.view
      await until(() => view.model?.status === 'ready' && view.reading?.marks.vocab?.rules().length)
      await view.engine.goTo(0)
      const firstDoc = await until(() => view.reading.marks.vocab.pages && [...view.reading.marks.vocab.pages.values()].find(p => p.index === 0 && p.doc.querySelector('.abele-vocab-mark'))?.doc)
      const first = firstDoc?.querySelectorAll('.abele-vocab-mark line').length ?? 0
      const firstPage = [...view.reading.marks.vocab.pages.values()].find(p => p.index === 0)
      const split = firstPage?.text.nodes.some((n, i) => n.data === 'sam' && firstPage.text.nodes[i + 1]?.data === 'ple')
      await view.engine.goTo(1)
      const secondDoc = await until(() => [...view.reading.marks.vocab.pages.values()].find(p => p.index === 1 && p.doc.querySelector('.abele-vocab-mark'))?.doc)
      const second = secondDoc?.querySelectorAll('.abele-vocab-mark line').length ?? 0
      await view.engine.goTo(0)
      const back = await until(() => [...view.reading.marks.vocab.pages.values()].find(p => p.index === 0 && p.drawn.length))
      const range = back?.doc.createRange()
      if (range && back?.text.nodes[0] && back.text.nodes[1]) {
        range.setStart(back.text.nodes[0], 0)
        range.setEnd(back.text.nodes[1], back.text.nodes[1].length)
      }
      const r = range?.getClientRects()[0]
      if (r) {
        const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2
        const target = back.doc.elementFromPoint(x, y) ?? back.doc.body
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      }
      const opened = await until(() => app.workspace.getActiveFile()?.path === ${JSON.stringify(CARD)} && app.workspace.getActiveFile()?.path)
      leaf.detach()
      return { first, second, opened, split }
    `)
    expect(result.error).toBeUndefined()
    expect(result.split).toBe(true)
    expect(result.first).toBeGreaterThan(0)
    expect(result.second).toBeGreaterThan(0)
    expect(result.opened).toBe(CARD)
  })

  it.skipIf(!onPhone())(
    'opens a studied PDF word from a real touch',
    () => {
      const at = run<{ error?: string; x?: number; y?: number; lines?: number }>(`
      let leaf; try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.getLeaf(false) }
      await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
      const view = leaf.view
      await until(() => view.model?.status === 'ready' && view.reading?.marks.vocab?.rules().length)
      await view.engine.goTo(0)
      const page = await until(() => [...view.reading.marks.vocab.pages.values()].find(p => p.index === 0 && p.drawn.length))
      const range = page?.doc.createRange()
      if (range && page?.text.nodes[0] && page.text.nodes[1]) {
        range.setStart(page.text.nodes[0], 0)
        range.setEnd(page.text.nodes[1], page.text.nodes[1].length)
      }
      const r = range?.getClientRects()[0]
      const frame = page?.doc.defaultView?.frameElement?.getBoundingClientRect()
      return { lines: page?.doc.querySelectorAll('.abele-vocab-mark line').length ?? 0,
        x: r && frame ? Math.round(frame.left + (r.left + r.right) / 2) : null,
        y: r && frame ? Math.round(frame.top + (r.top + r.bottom) / 2) : null }
    `)
      expect(at.error).toBeUndefined()
      expect(at.lines).toBeGreaterThan(0)
      expect(at.x).toBeTypeOf('number')
      expect(at.y).toBeTypeOf('number')
      screenshot(`${SHOTS}/book-pdf-vocab-lines.png`)
      tap(at.x!, at.y!)
      const opened = run<{ error?: string; path?: string | null }>(`
      const path = await until(() => app.workspace.getActiveFile()?.path === ${JSON.stringify(CARD)} && app.workspace.getActiveFile()?.path)
      return { path }
    `)
      expect(opened.error).toBeUndefined()
      expect(opened.path).toBe(CARD)
      screenshot(`${SHOTS}/book-pdf-vocab-card.png`)
    },
    120_000
  )

  it.skipIf(onPhone())(
    'keeps PDF vocabulary tappable in a phone-sized window',
    async () => {
      const size = evalJson<[number, number]>(
        "require('@electron/remote').getCurrentWindow().getContentSize()"
      )
      try {
        await reloadApp('app.emulateMobile(true)')
        evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
        await reloadApp('window.location.reload()')
        const result = run<{ error?: string; lines?: number; target?: string }>(`
        const leaf = app.workspace.getLeaf('tab')
        await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
        const view = leaf.view
        await until(() => view.model?.status === 'ready' && view.reading?.marks.vocab?.rules().length)
        await view.engine.goTo(0)
        const page = await until(() => [...view.reading.marks.vocab.pages.values()].find(p => p.index === 0 && p.drawn.length))
        const lines = page?.doc.querySelectorAll('.abele-vocab-mark line').length ?? 0
        const range = page?.doc.createRange()
        if (range && page?.text.nodes[0] && page.text.nodes[1]) {
          range.setStart(page.text.nodes[0], 0)
          range.setEnd(page.text.nodes[1], page.text.nodes[1].length)
        }
        const r = range?.getClientRects()[0]
        const target = r && view.reading.marks.vocab.at(page.doc, (r.left + r.right) / 2, (r.top + r.bottom) / 2)?.rules[0]?.target.path
        leaf.detach()
        return { lines, target }
      `)
        expect(result.error).toBeUndefined()
        expect(result.lines).toBeGreaterThan(0)
        expect(result.target).toBe(CARD)
      } finally {
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
        )
        await reloadApp('app.emulateMobile(false)')
      }
    },
    180_000
  )
})
