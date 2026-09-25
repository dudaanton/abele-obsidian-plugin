/**
 * Where highlights go, in the running app: one note for every book made from a template, then a
 * book's own choice from its Aa dialog sending the next one to a note of its own, the book showing
 * both. The run's folder, and the reader settings it changes, are put back after.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader notes file e2e'
const BOOK = `${DIR}/rich.epub`
const SHARED = `${DIR}/Reading/Shared.md`
const TEMPLATE = `${DIR}/Book template.md`
const OWN = `${DIR}/rich highlights.md`
const TEMPLATE_TEXT = [
  '---',
  'tags: [reading]',
  '---',
  '# Notes from {{ title }}',
  '',
  '{{#body}}',
  '## {{ chapter }} · {{ color }}',
  '{{ highlight }}',
  '{{/body}}',
  '',
].join('\n')

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
  const select = async (view, from, to) => {
    const node = pageDoc(view).getElementById('with-note').firstChild
    const doc = node.ownerDocument
    const range = doc.createRange()
    range.setStart(node, from)
    range.setEnd(node, to)
    doc.getSelection().removeAllRanges()
    doc.getSelection().addRange(range)
    return until(() => view.model.selection, 3000)
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

describe.skipIf(!available)('where highlights go', () => {
  beforeAll(() => {
    evalRaw(
      `(async () => {
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        window.__abeleNotesSaved = JSON.parse(JSON.stringify(cfg.reader))
        cfg.reader = { ...cfg.reader, notesTo: 'note', notesPath: ${JSON.stringify(SHARED)}, notesTemplate: ${JSON.stringify(TEMPLATE)}, bookNotes: {} }
        await cfg.saveSettings()
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        await app.vault.create(${JSON.stringify(TEMPLATE)}, ${JSON.stringify(TEMPLATE_TEXT)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(buildRichEpub()).toString('base64'))}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        if (window.__abeleNotesSaved) { cfg.reader = window.__abeleNotesSaved; await cfg.saveSettings() }
        delete window.__abeleNotesSaved
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  it('makes the shared note from the template, adds only its body after, and a book may choose its own', () => {
    const r = run<{
      error?: string
      first?: string | null
      second?: string | null
      rows?: string[]
      choice?: unknown
      own?: string | null
      shown?: string[]
      afterRemove?: string | null
    }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(0)
      await wait(600)
      await select(view, 2, 7)
      await view.reading.highlight('green')
      await until(() => view.model.highlights.length === 1, 5000)
      const first = await read(${JSON.stringify(SHARED)})
      await select(view, 13, 18)
      await view.reading.highlight('blue')
      await until(() => view.model.highlights.length === 2, 5000)
      const second = await read(${JSON.stringify(SHARED)})

      // The book's own choice, made in its Aa dialog as a person makes it.
      view.model.settingsOpen = true
      await until(() => document.querySelector('.abele-book-notes'), 4000)
      const box = document.querySelector('.abele-book-notes')
      const rows = [...box.querySelectorAll('.setting-item-name')].map((n) => n.textContent)
      const pick = box.querySelector('select')
      pick.value = 'book'
      pick.dispatchEvent(new Event('change', { bubbles: true }))
      await wait(600)
      const choice = window.__abeleTest.AbeleConfig.getInstance().reader.bookNotes
      view.model.settingsOpen = false
      await wait(300)

      await select(view, 21, 27)
      await view.reading.highlight('pink')
      await until(() => view.model.highlights.length === 3, 5000)
      const own = await read(${JSON.stringify(OWN)})
      const shown = view.model.highlights.map((h) => h.text).sort()
      const blue = view.model.highlights.find((h) => h.color === 'blue')
      await view.reading.remove(blue)
      await until(() => view.model.highlights.length === 2, 5000)
      const afterRemove = await read(${JSON.stringify(SHARED)})
      leaf.detach()
      return { first, second, rows, choice, own, shown, afterRemove }
    `)
    expect(r.error).toBeUndefined()
    expect(r.first).toContain('tags: [reading]')
    expect(r.first).toContain('# Notes from Rich test book')
    expect(r.first).toMatch(
      /## Chapter 1 · green\n> \[!quote\|green\] \[\[.*rich\.epub#cfi=.*\|Chapter 1\]\]\n> claim/
    )
    expect(r.second!.match(/# Notes from/g)).toHaveLength(1)
    expect(r.second).toMatch(/## Chapter 1 · blue\n> \[!quote\|blue\] .*\n> needs/)
    expect(r.rows).toEqual(['Where they go', 'Note', 'Template'])
    expect(Object.values(r.choice as object)).toEqual([{ notesTo: 'book' }])
    // A note of the book's own from the same template, which still says whose it is.
    expect(r.own).toContain('type: book-highlights')
    expect(r.own).toContain('# Notes from Rich test book')
    expect(r.own).toMatch(/> \[!quote\|pink\] .*\n> source/)
    expect(r.shown).toEqual(['claim', 'needs', 'source'])
    expect(r.afterRemove).not.toContain('## Chapter 1 · blue')
    expect(r.afterRemove).not.toContain('> needs')
    expect(r.afterRemove).toContain('> claim')
  })
})
