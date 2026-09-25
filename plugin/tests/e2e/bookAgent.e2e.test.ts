/**
 * The agent and books, in the running app: the book tools against a real book and PDF — what is
 * open and selected, the contents, a part's text, a search, showing a place — the chat's scope
 * deciding which books it reaches, and "Ask here" on selected words. The book and the PDF are
 * written to a folder for the run and removed after it; the scope and the AI switch are put back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader agent e2e'
const BOOK = `${DIR}/rich.epub`
const PDF = `${DIR}/plain.pdf`

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const tools = Object.fromEntries(window.__abeleTest.createBookTools().map((t) => [t.name, t]))
  /** A tool's answer as text, or what it refused with. */
  const call = async (name, params = {}) => {
    try {
      const r = await tools[name].execute('t', params)
      return r.content.map((c) => c.text).join('')
    } catch (e) {
      return 'ERROR: ' + (e?.message ?? String(e))
    }
  }
  const open = async (path) => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready', 15000)
    await wait(600)
    return { leaf, view }
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    44_000
  )

describe.skipIf(!available)('the agent and books', () => {
  beforeAll(() => {
    const files = {
      'rich.epub': Buffer.from(buildRichEpub()).toString('base64'),
      'plain.pdf': Buffer.from(buildPlainPdf()).toString('base64'),
    }
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        // The tools answer to the chat's scope; for the run it reaches this folder and no further.
        const scope = window.__abeleTest.ScopeResolver.getInstance()
        window.__abeleBookAgentE2E = {
          full: scope.fullVaultAccess.value,
          entries: JSON.parse(JSON.stringify(scope.entries.value)),
          ai: window.__abeleTest.AbeleConfig.getInstance().ai?.enabled,
          rightCollapsed: app.workspace.rightSplit.collapsed,
        }
        scope.clear()
        scope.setFullVaultAccess(false)
        scope.addFolder(${JSON.stringify(DIR)})
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const saved = window.__abeleBookAgentE2E
        if (saved) {
          const scope = window.__abeleTest.ScopeResolver.getInstance()
          scope.clear()
          for (const e of saved.entries) {
            if (e.type === 'file') scope.addFile(e.path)
            else if (e.type === 'folder') scope.addFolder(e.path)
            else if (e.type === 'pattern') scope.addPattern(e.path ?? e.pattern)
            else if (e.type === 'group') scope.addGroup(e.path)
          }
          scope.setFullVaultAccess(saved.full)
          const config = window.__abeleTest.AbeleConfig.getInstance()
          if (config.ai) config.ai.enabled = saved.ai
          // The chat opened the right sidebar; it goes back the way the run found it.
          if (saved.rightCollapsed) app.workspace.rightSplit.collapse()
        }
        delete window.__abeleBookAgentE2E
        const input = document.querySelector('.abele-chat-input__textarea')
        if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })) }
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  it('book_views says what is on screen and quotes the words selected, with a link to them', () => {
    const r = run<{ error?: string; none?: string; views?: string }>(`
      for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
      const none = await call('book_views')
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(0)
      await wait(500)
      const doc = view.engine.renderer.getContents()[0].doc
      const text = doc.getElementById('with-note').firstChild
      const range = doc.createRange(); range.setStart(text, 2); range.setEnd(text, 7)
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      const views = await call('book_views')
      leaf.detach()
      return { none, views }
    `)
    expect(r.error).toBeUndefined()
    expect(r.none).toMatch(/No book is open/)
    expect(r.views).toContain(`${BOOK}`)
    expect(r.views).toContain('At: Chapter 1')
    expect(r.views).toMatch(
      /Selected: \[\[rich\.epub#cfi=\/6\/2!\/4\/4%5Bwith-note%5D,\/1:2,\/1:7\|Chapter 1\]\]/
    )
    expect(r.views).toContain('> claim')
    expect(r.views).toContain('Highlights: none yet')
  })

  it('book_contents, book_read and book_search read a book that is not open', () => {
    const r = run<{
      error?: string
      contents?: string
      part?: string
      more?: string
      search?: string
      fromPlace?: string
    }>(`
      for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
      const contents = await call('book_contents', { book: ${JSON.stringify(BOOK)} })
      const part = await call('book_read', { book: ${JSON.stringify(BOOK)}, part: 3, limit: 600 })
      const more = await call('book_read', { book: ${JSON.stringify(BOOK)}, part: 3, offset: 600, limit: 600 })
      const search = await call('book_search', { book: ${JSON.stringify(BOOK)}, query: 'second note' })
      const link = /\\[\\[[^\\]]+\\]\\]/.exec(search.split('\\n').find((l) => l.startsWith('1.')) ?? '')?.[0]
      const fromPlace = link ? await call('book_read', { book: link, limit: 300 }) : 'no link in: ' + search
      return { contents, part, more, search, fromPlace }
    `)
    expect(r.error).toBeUndefined()
    expect(r.contents).toContain('Rich test book — Abele')
    expect(r.contents).toMatch(/4 parts/)
    expect(r.contents).toMatch(/Chapter 1, part two → part 1/)
    expect(r.part).toMatch(/^Rich test book — part 3 of 4: Chapter 3/)
    expect(r.part).toContain('Chapter 3\n\nPlain text of the chapter')
    expect(r.part).toMatch(/More in this part: book_read with part 3, offset 600/)
    expect(r.more).toContain('Characters 600–1200')
    expect(r.search).toMatch(/^1 find of "second note"/)
    expect(r.search).toContain('**second note**')
    expect(r.fromPlace).toMatch(/part 4 of 4: Notes/)
    expect(r.fromPlace).toContain('The second note, at the end of the book.')
  })

  it('book_open shows the person the place, the words selected, reusing the tab', () => {
    const r = run<{
      error?: string
      answer?: string
      tabs?: number
      selected?: string
      chapter?: string
    }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      const search = await call('book_search', { book: ${JSON.stringify(BOOK)}, query: 'part two' })
      // The second find: the heading of chapter two's second half.
      const link = /\\[\\[[^\\]]+\\]\\]/.exec(search.split('\\n').find((l) => l.startsWith('2.')) ?? '')?.[0]
      const answer = await call('book_open', { link })
      await wait(1500)
      const tabs = app.workspace.getLeavesOfType('abele-book').length
      const doc = view.engine.renderer.getContents()[0].doc
      const out = { answer, tabs, selected: doc.getSelection().toString(), chapter: view.model.chapter }
      leaf.detach()
      return out
    `)
    expect(r.error).toBeUndefined()
    expect(r.answer).toMatch(/at the place/)
    expect(r.tabs).toBe(1)
    expect(r.selected).toBe('part two')
    expect(r.chapter).toBe('Chapter 2, part two')
  })

  it('reads a PDF the same way, by its pages', () => {
    const r = run<{ error?: string; contents?: string; page?: string; search?: string }>(`
      const contents = await call('book_contents', { book: ${JSON.stringify(PDF)} })
      const page = await call('book_read', { book: ${JSON.stringify(PDF)} + '#page=2' })
      const search = await call('book_search', { book: ${JSON.stringify(PDF)}, query: 'lazy dog' })
      return { contents, page, search }
    `)
    expect(r.error).toBeUndefined()
    expect(r.contents).toContain('5 pages')
    expect(r.contents).toMatch(/Part two → part 4/)
    expect(r.page).toMatch(/part 2 of 5: Page 2/)
    expect(r.page).toContain('Page 2 of the test document')
    expect(r.search).toMatch(/^5 finds of "lazy dog"/)
    expect(r.search).toContain('[[plain.pdf#page=1|Page 1]]')
  })

  it('reaches only the books in the chat’s scope', () => {
    const r = run<{ error?: string; denied?: string; views?: string }>(`
      const scope = window.__abeleTest.ScopeResolver.getInstance()
      const { leaf } = await open(${JSON.stringify(BOOK)})
      scope.clear()
      scope.addFolder('Somewhere else')
      const denied = await call('book_read', { book: ${JSON.stringify(BOOK)}, part: 1 })
      const views = await call('book_views')
      scope.clear()
      scope.addFolder(${JSON.stringify(DIR)})
      leaf.detach()
      return { denied, views }
    `)
    expect(r.error).toBeUndefined()
    expect(r.denied).toMatch(/^ERROR: Access denied: .*rich\.epub is not in this chat's scope/)
    expect(r.views).toMatch(/1 book tab is open, outside this chat's scope/)
  })

  it('"Chat about this" with no words selected opens a chat with a link to the page, and lets it read the book', () => {
    // Words selected start a discussion kept with them: bookDiscussions.e2e.test.ts.
    const r = run<{ error?: string; text?: string; granted?: boolean }>(`
      const config = window.__abeleTest.AbeleConfig.getInstance()
      if (config.ai) config.ai.enabled = true
      config.version.value++
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(2)
      await wait(500)
      await view.reading.ask()
      const input = await until(() => {
        const i = document.querySelector('.abele-chat-input__textarea')
        return i && i.value.includes('rich.epub') ? i : null
      }, 8000)
      const chat = window.__abeleTest.ChatService.getInstance()
      const session = chat.activeSession?.value ?? chat.sessions?.value?.at?.(-1)
      const granted = session?.scopeResolver?.isInScope?.(${JSON.stringify(BOOK)})
      leaf.detach()
      return { text: input?.value, granted }
    `)
    expect(r.error).toBeUndefined()
    expect(r.granted).toBe(true)
    expect(r.text).toMatch(/^\[\[rich\.epub#cfi=[^\]]+\|Chapter 3\]\] $/)
  })
})
