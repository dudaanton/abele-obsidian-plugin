/** A reader-library script in a real tab, using only invented books. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildLongPdf } from '../fixtures/books/pdfFixture'
import { targets } from './helpers/target'

targets('desktop', 'phone')

const DIR = 'Sample reader library e2e'
const FILE = `${DIR}/sample.pdf`
const SCRIPT = `// @name Sample reader library
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
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => JSON.stringify(await (async () => {
  try { ${body} } catch (e) { return { error: String(e && e.stack || e) } }
})()))()`,
    90_000
  )

const wait = `const wait = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn) => { for (let i = 0; i < 80; i++) { const value = fn(); if (value) return value; await wait(100) } throw new Error('Timed out waiting for reader') };`

describe.skipIf(!available)('reader-file script dashboard', () => {
  beforeAll(() => {
    const binary = Buffer.from(buildLongPdf(8)).toString('base64')
    const result = run<string>(`
      const config = window.__abeleTest.AbeleConfig.getInstance()
      const folder = config.ai.scriptsFolder
      for (const leaf of app.workspace.getLeavesOfType('abele-script-view')) leaf.detach()
      const dir = app.vault.getAbstractFileByPath('${DIR}')
      if (dir) await app.vault.delete(dir, true)
      await app.vault.createFolder('${DIR}')
      const bytes = Uint8Array.from(atob('${binary}'), c => c.charCodeAt(0))
      await app.vault.createBinary('${FILE}', bytes.buffer)
      if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder)
      const path = folder + '/Sample reader library.js'
      const old = app.vault.getAbstractFileByPath(path)
      if (old) await app.vault.delete(old)
      await app.vault.create(path, ${JSON.stringify(SCRIPT)})
      await window.__abeleTest.ScriptService.getInstance().discover()
      return 'ready'
    `)
    expect(result).toBe('ready')
  }, 90_000)

  afterAll(() => {
    run(`
      for (const leaf of app.workspace.getLeavesOfType('abele-book'))
        if (leaf.view.file?.path === '${FILE}') leaf.detach()
      for (const leaf of app.workspace.getLeavesOfType('abele-script-view')) leaf.detach()
      const folder = window.__abeleTest.AbeleConfig.getInstance().ai.scriptsFolder
      const script = app.vault.getAbstractFileByPath(folder + '/Sample reader library.js')
      if (script) await app.vault.delete(script)
      const dir = app.vault.getAbstractFileByPath('${DIR}')
      if (dir) await app.vault.delete(dir, true)
      const scriptsDir = app.vault.getAbstractFileByPath(folder)
      if (scriptsDir?.children?.length === 0) await app.vault.delete(scriptsDir, true)
      delete window.__abeleBookSnapshot
      return true
    `)
  }, 90_000)

  it('lists an unopened file without parsing it and opens it without replacing the script tab', () => {
    const result = run<{
      error?: string
      before: { progress: number | null; pageCount: number | null }
      after: { pageCount: number; pageUnit: string; lastOpenedAt: number; progress: number }
      tabs: number
      cards: number
    }>(`
      ${wait}
      const service = window.__abeleTest.ScriptService.getInstance()
      const script = service.getAll().find(s => s.meta.name === 'Sample reader library')
      await service.execute(script.path, {}, { source: 'command' })
      const before = await until(() => window.__abeleBookSnapshot)
      const tab = app.workspace.getLeavesOfType('abele-script-view')[0]
      const cards = tab.view.contentEl.querySelectorAll('.abele-card').length
      const btn = tab.view.contentEl.querySelector('button')
      if (!btn) throw new Error('Read button not rendered')
      btn.click()
      const reader = await until(() => app.workspace.getLeavesOfType('abele-book')
        .find(l => l.view.file?.path === '${FILE}' && l.view.model?.status === 'ready')?.view)
        .catch(e => { throw new Error(String(e) + ': ' + JSON.stringify(app.workspace.getLeavesOfType('abele-book').map(l => ({ path: l.view.file?.path, status: l.view.model?.status, message: l.view.model?.message })))) })
      const after = await until(() => window.__abeleBookSnapshot?.pageCount ? window.__abeleBookSnapshot : null)
        .catch(e => { throw new Error(String(e) + ': ' + JSON.stringify(window.__abeleBookSnapshot)) })
      return { before, after, cards, tabs: app.workspace.getLeavesOfType('abele-script-view').length }
    `)
    expect(result.error).toBeUndefined()
    expect(result.before.progress).toBeNull()
    expect(result.before.pageCount).toBeNull()
    expect(result.cards).toBeGreaterThan(0)
    expect(result.tabs).toBe(1)
    expect(result.after).toMatchObject({
      pageUnit: 'pages',
      pageCount: 8,
      lastOpenedAt: expect.any(Number),
    })
  }, 90_000)
})
