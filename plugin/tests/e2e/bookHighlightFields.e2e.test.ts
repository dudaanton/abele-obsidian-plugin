/**
 * A highlights template with the quote and the comment as fields of their own, in the running
 * app: a highlight written with an empty comment field, a comment added later written into that
 * field and nowhere else, and the book, opened again, drawing the highlight and showing its
 * comment. The run's folder, and the reader settings it changes, are put back after.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader highlight fields e2e'
const BOOK = `${DIR}/rich.epub`
const NOTE = `${DIR}/Reading.md`
const TEMPLATE = `${DIR}/Fields template.md`
const TEMPLATE_TEXT = [
  '# {{ title }}',
  '',
  '{{#body}}',
  '## {{ chapter }}',
  '{{ quote }}',
  '',
  '**Comment:** {{ comment }}',
  '',
  '---',
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
  const rects = (view) =>
    view.engine.renderer.getContents()[0]?.overlayer?.element.querySelectorAll('rect').length ?? 0
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    44_000
  )

describe.skipIf(!available)('a template with the quote and the comment apart', () => {
  beforeAll(() => {
    evalRaw(
      `(async () => {
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        window.__abeleFieldsSaved = JSON.parse(JSON.stringify(cfg.reader))
        cfg.reader = { ...cfg.reader, notesTo: 'note', notesPath: ${JSON.stringify(NOTE)}, notesTemplate: ${JSON.stringify(TEMPLATE)}, bookNotes: {} }
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
        if (window.__abeleFieldsSaved) { cfg.reader = window.__abeleFieldsSaved; await cfg.saveSettings() }
        delete window.__abeleFieldsSaved
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  it('writes the quote and a comment added later each in its place, and draws the highlight again', () => {
    const r = run<{
      error?: string
      first?: string | null
      commented?: string | null
      changed?: string | null
      comment?: string
      drawn?: number
      texts?: string[]
    }>(`
      let { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(0)
      await wait(600)
      await select(view, 2, 7)
      await view.reading.highlight('green')
      await until(() => view.model.highlights.length === 1, 5000)
      await select(view, 13, 18)
      await view.reading.highlight('blue')
      await until(() => view.model.highlights.length === 2, 5000)
      const first = await read(${JSON.stringify(NOTE)})

      const green = view.model.highlights.find((h) => h.color === 'green')
      await view.reading.save({ ...green, comment: 'Worth a source.' })
      const commented = await read(${JSON.stringify(NOTE)})
      await view.reading.save({ ...view.model.highlights.find((h) => h.color === 'green'), comment: 'Worth two sources.' })
      const changed = await read(${JSON.stringify(NOTE)})
      leaf.detach()

      // Opened again: read back from the note alone.
      ;({ leaf, view } = await open(${JSON.stringify(BOOK)}))
      await view.engine.goTo(0)
      await until(() => rects(view) > 0, 5000)
      const drawn = rects(view)
      const comment = view.model.highlights.find((h) => h.color === 'green')?.comment
      const texts = view.model.highlights.map((h) => h.text).sort()
      leaf.detach()
      return { first, commented, changed, comment, drawn, texts }
    `)
    expect(r.error).toBeUndefined()
    // The quote in its callout, the comment's field empty beside it.
    expect(r.first).toMatch(
      /## Chapter 1\n> \[!quote\|green\] \[\[.*rich\.epub#cfi=.*\|Chapter 1\]\]\n> claim\n\n\*\*Comment:\*\*\n\n---/
    )
    expect(r.first!.match(/\*\*Comment:\*\*/g)).toHaveLength(2)
    // The comment in its field, and the note otherwise line for line as it was.
    expect(r.commented).toMatch(/> claim\n\n\*\*Comment:\*\* Worth a source\.\n\n---/)
    expect(r.commented).not.toMatch(/> Worth a source/)
    const diff = (a: string, b: string) => {
      const x = a.split('\n')
      const y = b.split('\n')
      expect(y).toHaveLength(x.length)
      return y.filter((line, i) => line !== x[i])
    }
    expect(diff(r.first!, r.commented!)).toEqual(['**Comment:** Worth a source.'])
    expect(diff(r.commented!, r.changed!)).toEqual(['**Comment:** Worth two sources.'])
    expect(r.drawn).toBeGreaterThan(0)
    expect(r.comment).toBe('Worth two sources.')
    expect(r.texts).toEqual(['claim', 'needs'])
  })
})
