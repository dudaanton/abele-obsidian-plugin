/** A reader-library script in a real tab, using only invented books. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildLongPdf } from '../fixtures/books/pdfFixture'
import { onPhone, targets } from './helpers/target'
import { SCRIPT_FIXTURE, type ScriptFixtureSnapshot } from './helpers/scriptFixture'

targets('desktop', 'phone')

const RUN_ID = randomUUID()
const DIR = `Sample reader library ${RUN_ID}`
const FILE = `${DIR}/sample-book.pdf`
const SCRIPT_PATH = `${DIR}/Scripts/Sample reader library.js`
const SCRIPT_NAME = `Sample library ${RUN_ID}`
let layout: unknown
const SCRIPT = `// @name ${SCRIPT_NAME}
const v = view({ title: 'Sample reader library' })
let items = []
async function refresh() {
  items = await books.list()
  if (v.signal.aborted) return
  const book = items.find(b => b.path === '${FILE}')
  v.body = [new Text('Books: ' + items.length), new Grid(book ? [new Card({
    title: book.title || book.path, description: book.progress === null ? 'No saved position' :
      Math.round(book.progress * 100) + '%',
    actions: [new Button({ text: book.position ? 'Continue' : 'Read', onClick: () => books.open(book.path) })]
  })] : [])]
  window.__abeleBookSnapshot = book
}
books.onChange(() => v.run(refresh), { signal: v.signal })
await v.open()
await refresh()
`
const available = isObsidianRunning() && hasTestApi()
let fixture: ScriptFixtureSnapshot
let owned = false
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => JSON.stringify(await (async () => {
  ${SCRIPT_FIXTURE}
  try { ${body} } catch (e) { return { error: String(e?.message || e) + '\\n' + String(e?.stack || '') } }
})()))()`,
    90_000
  )

const wait = `const wait = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn) => { for (let i = 0; i < 80; i++) { const value = fn(); if (value) return value; await wait(100) } throw new Error('Timed out waiting for reader') };`

describe.skipIf(!available)('reader-file script dashboard', () => {
  beforeAll(() => {
    layout = evalJson('app.workspace.getLayout()')
    fixture = run<ScriptFixtureSnapshot>('return await saveScriptFixture()')
    expect(fixture.ai).toBeDefined()
    const binary = Buffer.from(buildLongPdf(8)).toString('base64')
    const result = run<string>(`
      const folder = '${DIR}/Scripts'
      const dir = app.vault.getAbstractFileByPath('${DIR}')
      if (dir) throw Error('Synthetic folder already exists')
      await app.vault.createFolder('${DIR}')
      window.__abeleBookFixtureOwned = true
      const bytes = Uint8Array.from(atob('${binary}'), c => c.charCodeAt(0))
      await app.vault.createBinary('${FILE}', bytes.buffer)
      if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder)
      const path = folder + '/Sample reader library.js'
      await app.vault.create(path, ${JSON.stringify(SCRIPT)})
      await enableScriptFixture(folder)
      await approveScriptFixture(path, ${JSON.stringify(SCRIPT)})
      return 'ready'
    `)
    expect(result).toBe('ready')
    owned = true
  }, 90_000)

  afterAll(() => {
    expect(
      run(`
      try {
      for (const leaf of app.workspace.getLeavesOfType('abele-book'))
        if (leaf.view.file?.path === '${FILE}') leaf.detach()
      const folder = '${DIR}/Scripts'
      for (const leaf of app.workspace.getLeavesOfType('abele-script-view'))
        if (leaf.view.getState()?.script === ${JSON.stringify(SCRIPT_NAME)}) leaf.detach()
      const script = app.vault.getAbstractFileByPath(folder + '/Sample reader library.js')
      if ((${owned} || window.__abeleBookFixtureOwned) && script) await app.vault.delete(script)
      const dir = app.vault.getAbstractFileByPath('${DIR}')
      if ((${owned} || window.__abeleBookFixtureOwned) && dir) await app.vault.delete(dir, true)
      delete window.__abeleBookSnapshot
      await app.workspace.changeLayout(${JSON.stringify(layout)})
      return true
      } finally {
        await restoreScriptFixture(${JSON.stringify(fixture)})
        delete window.__abeleBookFixtureOwned
      }
    `)
    ).toBe(true)
  }, 90_000)

  it('lists an unopened file without parsing it and opens it without replacing the script tab', () => {
    const result = run<{
      error?: string
      before: { progress: number | null; pageCount: number | null; highlightCount: number | null }
      after: {
        pageCount: number
        pageUnit: string
        lastOpenedAt: number
        progress: number
        highlightCount: number | null
      }
      tabs: number
      cards: number
    }>(`
      ${wait}
      const service = window.__abeleTest.ScriptService.getInstance()
      const script = service.get(${JSON.stringify(SCRIPT_PATH)})
      await service.execute(script.path, {}, { source: 'command' })
      const before = await until(() => window.__abeleBookSnapshot)
      const tabs = app.workspace.getLeavesOfType('abele-script-view').filter(l => l.view.getState()?.script === ${JSON.stringify(SCRIPT_NAME)})
      const tab = tabs[0]
      const cards = tab.view.contentEl.querySelectorAll('.abele-card').length
      const btn = tab.view.contentEl.querySelector('button')
      if (!btn) throw new Error('Read button not rendered')
      btn.click()
      const reader = await until(() => app.workspace.getLeavesOfType('abele-book')
        .find(l => l.view.file?.path === '${FILE}' && l.view.model?.status === 'ready')?.view)
        .catch(e => { throw new Error(String(e) + ': ' + JSON.stringify(app.workspace.getLeavesOfType('abele-book').map(l => ({ path: l.view.file?.path, status: l.view.model?.status, message: l.view.model?.message })))) })
      const after = await until(() => window.__abeleBookSnapshot?.pageCount && window.__abeleBookSnapshot.highlightCount !== null ? window.__abeleBookSnapshot : null)
        .catch(e => { throw new Error(String(e) + ': ' + JSON.stringify(window.__abeleBookSnapshot)) })
      return { before, after, cards, tabs: tabs.length }
    `)
    expect(result.error).toBeUndefined()
    expect(result.before.progress).toBeNull()
    expect(result.before.pageCount).toBeNull()
    expect(result.before.highlightCount).toBeNull()
    expect(result.cards).toBeGreaterThan(0)
    expect(result.tabs).toBe(1)
    expect(result.after).toMatchObject({
      highlightCount: 0,
      pageUnit: 'pages',
      pageCount: 8,
      lastOpenedAt: expect.any(Number),
    })
  }, 90_000)

  it('refreshes a cached highlight count when the last reader tab closes, without a file write', () => {
    const result = run<{ error?: string; before: number; after: number | null }>(`
      ${wait}
      // Let all delayed reader writes settle: closing must invalidate on its own.
      await wait(2500)
      const before = window.__abeleBookSnapshot.highlightCount
      const leaf = app.workspace.getLeavesOfType('abele-book')
        .find(l => l.view.file?.path === '${FILE}')
      if (!leaf) throw new Error('Sample reader tab missing')
      leaf.detach()
      await until(() => window.__abeleBookSnapshot?.highlightCount === null)
      return { before, after: window.__abeleBookSnapshot.highlightCount }
    `)
    expect(result.error).toBeUndefined()
    expect(result.before).toBe(0)
    expect(result.after).toBeNull()
  }, 90_000)

  it.skipIf(onPhone())(
    'fits its cards in an emulated phone viewport',
    async () => {
      const size = evalJson<[number, number]>(
        `require('@electron/remote').getCurrentWindow().getContentSize()`
      )
      try {
        evalRaw(
          `(() => { require('@electron/remote').getCurrentWindow().setContentSize(390, 844); return 'ok' })()`
        )
        await reloadApp('app.emulateMobile(true)')
        const result = run<{ error?: string; card: number; viewport: number; button: number }>(`
        ${wait}
        const service = window.__abeleTest.ScriptService.getInstance()
        await service.ready
        const script = service.get(${JSON.stringify(SCRIPT_PATH)})
        if (!script) throw new Error('The sample script was not restored')
        await service.execute(script.path, {}, { source: 'command' })
        const view = await until(() => app.workspace.getLeavesOfType('abele-script-view')
          .find(l => l.view.getState()?.script === ${JSON.stringify(SCRIPT_NAME)} && l.view?.contentEl?.querySelector('.abele-card'))?.view)
        const card = view.contentEl.querySelector('.abele-card').getBoundingClientRect()
        const button = view.contentEl.querySelector('button').getBoundingClientRect()
        return { card: card.right, button: button.right, viewport: window.innerWidth }
      `)
        expect(result.error).toBeUndefined()
        expect(result.card).toBeLessThanOrEqual(result.viewport)
        expect(result.button).toBeLessThanOrEqual(result.viewport)
        runCli(['dev:screenshot', `path=${process.cwd()}/build/book-library-mobile.png`])
      } finally {
        run(
          `for (const leaf of app.workspace.getLeavesOfType('abele-script-view')) if (leaf.view.getState()?.script === ${JSON.stringify(SCRIPT_NAME)}) leaf.detach(); return true`
        )
        await reloadApp('app.emulateMobile(false)')
        evalRaw(
          `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]}); return 'ok' })()`
        )
      }
    },
    90_000
  )
})
