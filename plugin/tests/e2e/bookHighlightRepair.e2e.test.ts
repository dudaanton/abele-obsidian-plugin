import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { buildJustifiedEpub } from '../fixtures/books/justifiedBook'

targets('desktop', 'phone')

const DIR = 'Book repair sample e2e'
const BOOK = `${DIR}/sample.epub`
const NOTE = `${DIR}/sample highlights.md`
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('confirming repairs on a real EPUB', () => {
  beforeAll(() => {
    const bytes = Buffer.from(buildJustifiedEpub()).toString('base64')
    evalRaw(`(async () => {
      if (app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) throw new Error('Fixture already exists')
      await app.vault.createFolder(${JSON.stringify(DIR)})
      await app.vault.createBinary(${JSON.stringify(BOOK)}, Uint8Array.from(atob(${JSON.stringify(bytes)}), c => c.charCodeAt(0)).buffer)
      return 'ok'
    })()`, 60_000)
  }, 90_000)

  afterAll(() => {
    evalRaw(`(async () => {
      for (const leaf of app.workspace.getLeavesOfType('abele-book'))
        if (leaf.view?.file?.path === ${JSON.stringify(BOOK)}) leaf.detach()
      for (const leaf of app.workspace.getLeavesOfType('markdown'))
        if (leaf.view?.file?.path === ${JSON.stringify(NOTE)}) leaf.detach()
      const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (dir) await app.vault.delete(dir, true)
      return 'ok'
    })()`, 60_000)
  }, 90_000)

  it('keeps the note unchanged until confirmation, then changes only the saved CFI spans', async () => {
    const report = JSON.parse(await evalLong(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const until = async (fn, timeout = 15000) => {
        const end = Date.now() + timeout
        while (Date.now() < end) { const value = await fn(); if (value) return value; await wait(80) }
        throw new Error('Timed out waiting for reader or action')
      }
      let leaf
      try {
        leaf = app.workspace.getLeaf('tab')
        await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
        const view = await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading && leaf.view)
        const engine = view.engine
        await engine.goTo(0)
        const doc = await until(() => engine.renderer.getContents().find(c => c.index === 0)?.doc)
        const tail = (id, n) => {
          const text = [...doc.getElementById(id).childNodes].filter(x => x.nodeType === 3).pop()
          const start = text.data.length - text.data.split(' ').slice(-n).join(' ').length
          const range = doc.createRange(); range.setStart(text, start); range.setEnd(text, text.data.length)
          return range
        }
        const pairs = [[0, 4], [2, 5], [3, 1]].map(([old, next]) => ({
          old: engine.getCFI(0, tail('p1-0-' + old, 12)),
          suggested: engine.getCFI(0, tail('p1-0-' + next, 12)),
          words: String(tail('p1-0-' + next, 12)),
        }))
        const encoded = cfi => cfi.slice(8, -1).replace(/[\\[\\]|#%^()\\s]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
        leaf.detach()
        const noteText = '---\\ntype: book-highlights\\nfile: "[[sample.epub]]"\\n---\\n\\n' + pairs.map((p, i) =>
          '> [!quote|yellow] [[sample.epub#cfi=' + encoded(p.old) + '|Sample chapter]]\\n> ' + p.words + '\\n>\\n> Keep  comment ' + i + '  \\n').join('\\n')
        const file = await app.vault.create(${JSON.stringify(NOTE)}, noteText)
        leaf = app.workspace.getLeaf('tab')
        await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
        const opened = await until(() => leaf.view?.model?.highlights?.length === 3 && leaf.view)
        await opened.engine.goTo(0)
        await until(() => opened.reading.marks.repairs().length === 3)
        const before = await app.vault.read(file)
        if (before !== noteText) throw new Error('Detection modified note')
        const menu = async (all) => {
          opened.reading.marks.open(opened.model.highlights.find(h => h.cfi === pairs[0].old) || opened.model.highlights[0])
          const action = await until(() => document.querySelector('[aria-label="Repair highlight link…"]'))
          action.click()
          const options = await until(() => [...document.querySelectorAll('.menu-item')].filter(el => el.textContent.includes('Repair')))
          const option = options.find(el => el.textContent.includes(all ? 'all found' : 'this highlight'))
          if (!option) throw new Error('Missing menu choice: ' + options.map(x => x.textContent).join('|'))
          option.click()
          return until(() => [...document.querySelectorAll('.modal.abele-modal')].find(el => el.textContent.includes('Only mismatches found')))
        }
        let dialog = await menu(false)
        const shown = dialog.textContent
        dialog.querySelector('.abele-modal__footer button').click()
        await wait(150)
        const cancelled = await app.vault.read(file)
        dialog = await menu(false)
        ;[...dialog.querySelectorAll('.abele-modal__footer button')].find(b => b.textContent.includes('Repair')).click()
        await until(async () => (await app.vault.read(file)) !== before)
        const once = await app.vault.read(file)
        const expectedOne = noteText.replace('#cfi=' + encoded(pairs[0].old) + '|', '#cfi=' + encoded(pairs[0].suggested) + '|')
        if (once !== expectedOne) throw new Error('First repair changed unexpected bytes')
        // A still-unrepaired mark now offers an all-found action for the two remaining links.
        opened.reading.marks.open(opened.model.highlights.find(h => h.cfi === pairs[1].old))
        const action = await until(() => document.querySelector('[aria-label="Repair highlight link…"]'))
        action.click()
        const all = await until(() => [...document.querySelectorAll('.menu-item')].find(el => el.textContent.includes('all found')))
        all.click()
        dialog = await until(() => [...document.querySelectorAll('.modal.abele-modal')].find(el => el.textContent.includes('Only mismatches found')))
        ;[...dialog.querySelectorAll('.abele-modal__footer button')].find(b => b.textContent.includes('Repair')).click()
        const expected = pairs.slice(1).reduce((md, p) => md.replace('#cfi=' + encoded(p.old) + '|', '#cfi=' + encoded(p.suggested) + '|'), expectedOne)
        await until(async () => (await app.vault.read(file)) === expected)
        return JSON.stringify({ before: before === noteText, cancelled: cancelled === noteText, copy: shown.includes(pairs[0].words), one: once === expectedOne, all: (await app.vault.read(file)) === expected })
      } catch (error) { return JSON.stringify({ error: String(error?.stack || error) }) }
      finally { if (leaf?.view?.file?.path === ${JSON.stringify(BOOK)}) leaf.detach() }
    })()`, 180_000)) as { error?: string; before: boolean; cancelled: boolean; copy: boolean; one: boolean; all: boolean }
    expect(report.error).toBeUndefined()
    expect(report).toMatchObject({ before: true, cancelled: true, copy: true, one: true, all: true })
  }, 240_000)
})
