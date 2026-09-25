/**
 * Discussions in books, in the running app: "Ask here" on words starts a chat kept with them.
 *
 * With the rich book and the plain PDF (written for the run and removed after it), and the AI
 * turned on — nothing is sent to any model: the discussions are only opened, never asked:
 *
 * - on words of a book, Ask here makes a comment anchored to the book and the place, shows it in
 *   the AI sidebar, lists it in the highlights note with a link to its chat, and marks the words
 *   with a speech bubble; a tap on the words, and Ask here on them again, open the same chat;
 * - on a highlight, it keeps the highlight's colour and adds the discussion;
 * - after the app is reloaded the mark is drawn again and a tap opens the same chat;
 * - book_views names the discussions on the page on screen;
 * - the highlights panel lists them, and can show only them;
 * - removing the mark asks what becomes of the chat: kept (as an ordinary chat) or deleted;
 * - a PDF works the same, its mark drawn over the page.
 *
 * On a phone (390×844, `emulateMobile`) the marked words and the panel are pictured to
 * `/tmp/abele-phone/discussion-*.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader discussions e2e'
const BOOK = `${DIR}/rich.epub`
const PDF = `${DIR}/plain.pdf`
const NOTE = `${DIR}/rich highlights.md`
const PDF_NOTE = `${DIR}/plain highlights.md`
const SHOTS = '/tmp/abele-phone'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const reload = async (how: string): Promise<void> => {
  evalRaw(`(() => { setTimeout(() => { ${how} }, 50); return 'ok' })()`, 30_000)
  await pause(4000)
  const deadline = Date.now() + 60_000
  while (!hasTestApi() && Date.now() < deadline) await pause(1000)
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`
  )
}
const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const comments = window.__abeleTest.CommentService.getInstance()
  const open = async (path) => {
    // A new tab in the main area, made beside a leaf there before the book tabs of the last
    // step are closed: with them gone and a chat just shown, "a new tab" was made in the
    // sidebar's group, behind the chat, and the book never came on screen to be drawn.
    const old = app.workspace.getLeavesOfType('abele-book')
    let main = null
    app.workspace.iterateRootLeaves((l) => { if (!main) main = l })
    if (main) app.workspace.setActiveLeaf(main, { focus: false })
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = main ?? app.workspace.getLeaf(false) }
    await Promise.race([
      leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true }),
      wait(15000),
    ])
    for (const l of old) if (l !== leaf) l.detach()
    await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading, 15000)
    await wait(600)
    return { leaf, view: leaf.view }
  }
  const docOf = (view) => view.engine.renderer.getContents()[0].doc
  /** Selects characters of the first paragraph of a chapter, as a person would. */
  const selectIn = async (view, chapter, from, to) => {
    await view.engine.goTo(view.model.toc[chapter].href); await wait(600)
    const doc = docOf(view)
    const p = [...doc.querySelectorAll('p')].find((x) => x.textContent.length > 40)
    const range = doc.createRange(); range.setStart(p.firstChild, from); range.setEnd(p.firstChild, to)
    doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
    await until(() => view.model.selection, 3000)
    await wait(200)
    return range
  }
  const askIcon = (view) => [...view.contentEl.querySelectorAll('.abele-book-selection .abele-obsidian-icon')]
    .find((el) => /^(Ask the agent|Open the discussion)/.test(el.getAttribute('aria-label') ?? ''))
  /** A tap on words of a page, the way a finger's click reaches the page. */
  const tapOn = (range) => {
    const doc = range.startContainer.ownerDocument
    const r = range.getClientRects()[0]
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    doc.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView, clientX: x, clientY: y }))
  }
  const read = async (path) => {
    const f = app.vault.getAbstractFileByPath(path)
    return f ? app.vault.read(f) : ''
  }
  const closeChat = async () => {
    if (comments.open.value) await comments.hideFromSidebar(comments.open.value)
  }
  const shoot = async (name) => {
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/discussion-' + name + '.png', img.toPNG()) }
  }
`

const run = <T>(body: string, timeout = 90_000): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    timeout
  )

describe.skipIf(!available)('discussions in books', () => {
  let saved: { ai?: boolean; right?: boolean; reader?: unknown } = {}
  let size: [number, number] = [0, 0]
  let first: { error?: string; id?: string } = {}

  beforeAll(() => {
    const files = {
      'rich.epub': Buffer.from(buildRichEpub()).toString('base64'),
      'plain.pdf': Buffer.from(buildPlainPdf()).toString('base64'),
    }
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    saved = evalJson(
      `({ ai: window.__abeleTest.AbeleConfig.getInstance().ai?.enabled, right: app.workspace.rightSplit.collapsed, reader: window.__abeleTest.AbeleConfig.getInstance().reader })`
    )
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        const config = window.__abeleTest.AbeleConfig.getInstance()
        if (config.ai) config.ai.enabled = true
        config.reader = { ...config.reader, flow: 'paginated', pdfLayout: 'paginated' }
        await config.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(async () => {
    if (evalJson<boolean>('app.isMobile')) {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reload('app.emulateMobile(false)')
    }
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const comments = window.__abeleTest.CommentService.getInstance()
        // Every discussion of the run, its chat included.
        for (const f of app.vault.getFiles()) {
          if (f.extension !== 'abchat') continue
          const text = await app.vault.read(f)
          if (text.includes(${JSON.stringify(DIR)})) {
            try { await comments.remove(f.basename) } catch {}
            const still = app.vault.getAbstractFileByPath(f.path)
            if (still) await app.vault.delete(still)
          }
        }
        const config = window.__abeleTest.AbeleConfig.getInstance()
        if (config.ai) config.ai.enabled = ${JSON.stringify(saved.ai ?? false)}
        config.reader = ${JSON.stringify(saved.reader ?? {})}
        await config.saveSettings()
        if (${JSON.stringify(saved.right ?? true)}) app.workspace.rightSplit.collapse()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        // The comments folder the run's discussions made, and its parents, when nothing else is
        // in them: the fixture vault holds ScaleTest/ and nothing else.
        let folder = app.vault.getAbstractFileByPath(window.__abeleTest.ChatStorage?.commentsFolder?.() ?? 'AI/Comments')
        while (folder && folder.path !== '/' && folder.children?.length === 0) {
          const parent = folder.parent
          await app.vault.delete(folder, true)
          folder = parent
        }
        return 'ok'
      })()`,
      60_000
    )
  }, 180_000)

  it('Ask here on words starts a discussion: shown, listed in the note with its chat, marked with a bubble', () => {
    first = run<{
      error?: string
      id?: string
      shown?: boolean
      anchor?: unknown
      note?: string
      bubble?: boolean
      model?: unknown
    }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await selectIn(view, 2, 0, 20)
      askIcon(view).click()
      const id = await until(() => view.model.highlights.find((h) => h.discussion)?.discussion, 8000)
      const session = comments.sessionFor(id)
      const note = await read(${JSON.stringify(NOTE)})
      const overlay = view.engine.renderer.getContents()[0].overlayer?.element
      const bubble = !!(await until(() => overlay?.querySelector('.abele-discussion-bubble'), 3000))
      return {
        id, shown: comments.open.value === id,
        anchor: session?.anchor.value,
        note,
        bubble,
        model: view.model.highlights.find((h) => h.discussion),
      }
    `)
    expect(first.error).toBeUndefined()
    const r = first as typeof first & {
      shown: boolean
      anchor: { note: string; cfi: string; quote: string }
      note: string
      bubble: boolean
      model: { plain: boolean; text: string }
    }
    expect(r.id).toMatch(/^[a-z0-9]{6}$/)
    expect(r.shown).toBe(true)
    expect(r.anchor).toMatchObject({ note: BOOK, quote: 'Plain text of the ch' })
    expect(r.anchor.cfi).toMatch(/^epubcfi\(/)
    expect(r.note).toMatch(new RegExp(`> \\[!chat\\] .*rich\\.epub#cfi=.* · .*${r.id}\\.abchat`))
    expect(r.model).toMatchObject({ plain: true, text: 'Plain text of the ch' })
    expect(r.bubble).toBe(true)
  })

  it('a tap on the marked words, and Ask here on them again, open the same chat', () => {
    const r = run<{
      error?: string
      tapped?: string | null
      asked?: string | null
      count?: number
    }>(`
      const view = app.workspace.getLeavesOfType('abele-book')[0].view
      const id = view.model.highlights.find((h) => h.discussion).discussion
      await closeChat()
      await view.engine.goTo(view.model.toc[2].href); await wait(700)
      const doc = docOf(view)
      const p = [...doc.querySelectorAll('p')].find((x) => x.textContent.length > 40)
      const range = doc.createRange(); range.setStart(p.firstChild, 2); range.setEnd(p.firstChild, 8)
      tapOn(range)
      const tapped = await until(() => comments.open.value, 5000)
      await closeChat()
      // The words selected again, and Ask here: the same one.
      await selectIn(view, 2, 0, 20)
      askIcon(view).click()
      const asked = await until(() => comments.open.value, 5000)
      const count = view.model.highlights.filter((h) => h.discussion).length
      return { tapped, asked, count, id }
    `)
    expect(r.error).toBeUndefined()
    expect(r.tapped).toBe(first.id)
    expect(r.asked).toBe(first.id)
    expect(r.count).toBe(1)
  })

  it('on a highlight keeps its colour and adds the discussion; book_views names both on the page', () => {
    const r = run<{
      error?: string
      h?: { color: string; plain?: boolean; discussion?: string }
      views?: string
      note?: string
    }>(`
      const view = app.workspace.getLeavesOfType('abele-book')[0].view
      await closeChat()
      await selectIn(view, 2, 30, 50)
      await view.reading.highlight('green')
      await until(() => view.model.highlights.length === 2, 4000)
      const h0 = view.model.highlights.find((h) => h.color === 'green')
      // A tap on the highlight opens its bar; Ask here there asks about it.
      view.model.active = h0
      await wait(300)
      askIcon(view).click()
      const h = await until(() => view.model.highlights.find((x) => x.color === 'green' && x.discussion), 8000)
      const tools = Object.fromEntries(window.__abeleTest.createBookTools().map((t) => [t.name, t]))
      // The tools answer to the chat's scope: for this call it reaches the run's folder.
      const scope = window.__abeleTest.ScopeResolver.getInstance()
      const had = scope.isInScope(${JSON.stringify(BOOK)})
      if (!had) scope.addFolder(${JSON.stringify(DIR)})
      const views = (await tools.book_views.execute('t', {})).content.map((c) => c.text).join('')
      if (!had) scope.remove({ type: 'folder', path: ${JSON.stringify(DIR)} })
      return { h, views, note: await read(${JSON.stringify(NOTE)}) }
    `)
    expect(r.error).toBeUndefined()
    expect(r.h).toMatchObject({ color: 'green' })
    expect(r.h!.plain).toBeFalsy()
    expect(r.h!.discussion).toMatch(/^[a-z0-9]{6}$/)
    expect(r.note).toMatch(/> \[!quote\|green\] .* · .*\.abchat/)
    expect(r.views).toMatch(/Discussions on this page: 2/)
  })

  it('the highlights panel lists the discussions, can show only them, and opens their chat', () => {
    const r = run<{ error?: string; all?: number; only?: number; opened?: string | null }>(`
      const view = app.workspace.getLeavesOfType('abele-book')[0].view
      await closeChat()
      view.model.panelTab = 'highlights'; view.model.panel = true
      await wait(500)
      const items = () => view.contentEl.querySelectorAll('.abele-book-highlights__item')
      const all = items().length
      const select = view.contentEl.querySelector('.abele-book-highlights__filter select')
      select.value = 'discussions'; select.dispatchEvent(new Event('change', { bubbles: true }))
      await wait(300)
      const only = items().length
      view.contentEl.querySelector('.abele-book-highlights__item_discussion .abele-book-highlights__label .abele-obsidian-icon').click()
      const opened = await until(() => comments.open.value, 5000)
      view.model.panel = false
      return { all, only, opened }
    `)
    expect(r.error).toBeUndefined()
    expect(r.all).toBe(2)
    expect(r.only).toBe(2)
    expect(r.opened).toBe(first.id)
  })

  it('after the app is reloaded, the mark is drawn again and a tap opens the same chat', async () => {
    run(`await closeChat(); app.workspace.requestSaveLayout(); await wait(1500); return {}`)
    await reload('window.location.reload()')
    const r = run<{ error?: string; bubble?: boolean; tapped?: string | null }>(`
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(view.model.toc[2].href); await wait(900)
      const overlay = view.engine.renderer.getContents()[0].overlayer?.element
      const bubble = !!(await until(() => overlay?.querySelector('.abele-discussion-bubble'), 5000))
      const doc = docOf(view)
      const p = [...doc.querySelectorAll('p')].find((x) => x.textContent.length > 40)
      const range = doc.createRange(); range.setStart(p.firstChild, 2); range.setEnd(p.firstChild, 8)
      tapOn(range)
      const tapped = await until(() => comments.open.value, 8000)
      return { bubble, tapped }
    `)
    expect(r.error).toBeUndefined()
    expect(r.bubble).toBe(true)
    expect(r.tapped).toBe(first.id)
  })

  it('removing the mark asks what becomes of the chat: kept as a chat, or deleted with it', () => {
    const r = run<{
      error?: string
      asked?: string[]
      kept?: { note: boolean; file: boolean }
      deleted?: { note: boolean; file: boolean }
    }>(`
      const view = app.workspace.getLeavesOfType('abele-book')[0].view
      await closeChat()
      const choose = async (h, label) => {
        const done = view.reading.remove(h)
        const modal = await until(() => document.querySelector('.modal'), 3000)
        const buttons = [...modal.querySelectorAll('button')].map((b) => b.textContent.trim())
        ;[...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === label).click()
        await done
        await wait(500)
        return buttons
      }
      const plain = view.model.highlights.find((h) => h.plain)
      const keptPath = comments.commentPath(plain.discussion)
      const asked = await choose(plain, 'Keep the chat')
      const keptFile = app.vault.getAbstractFileByPath(keptPath)
      const kept = {
        note: (await read(${JSON.stringify(NOTE)})).includes(plain.discussion),
        file: !!keptFile,
      }
      const green = view.model.highlights.find((h) => h.discussion)
      const deletedPath = comments.commentPath(green.discussion)
      await choose(green, 'Delete the chat too')
      const deleted = {
        note: (await read(${JSON.stringify(NOTE)})).includes(green.discussion),
        file: !!app.vault.getAbstractFileByPath(deletedPath),
      }
      // The kept chat's tab is closed with the rest of the run.
      return { asked, kept, deleted }
    `)
    expect(r.error).toBeUndefined()
    expect(r.asked).toEqual(['Keep the chat', 'Delete the chat too', 'Cancel'])
    expect(r.kept).toMatchObject({ note: false, file: true })
    expect(r.deleted).toEqual({ note: false, file: false })
  })

  it('a PDF works the same: its mark drawn over the page, a tap opening the chat', () => {
    // In two calls, each well within one call's allowance: drawing a PDF page can be slow.
    const where = <T>(f: () => T): T => {
      try {
        return f()
      } catch (e) {
        throw new Error(`${(e as Error).message}, at ${evalRaw('String(window.__abeleDiscussionStep)')}`)
      }
    }
    const asked = where(() => run<{ error?: string; id?: string; bubble?: boolean }>(`
      // Where it got to, kept on the window: a call that runs out of time says nothing itself.
      const step = (s) => (window.__abeleDiscussionStep = s)
      step('close'); await closeChat()
      step('open')
      const { view } = await open(${JSON.stringify(PDF)})
      step('opened ' + view.model?.status + ' ' + view.model?.message)
      if (view.model.panel) { view.model.panel = false; await wait(300) }
      step('goto')
      await Promise.race([view.engine.goTo(0), wait(5000)])
      step('text')
      const doc = await until(() => view.engine.renderer.getContents().map((c) => c.doc).find((d) => d?.querySelector('.textLayer span')), 10000)
      if (!doc) {
        const c = view.engine?.renderer?.getContents?.() ?? []
        return { error: 'the page never drew its text: ' + JSON.stringify({ status: view.model.status, message: view.model.message, kind: view.model.kind, file: view.file?.path, contents: c.length, docs: c.map((x) => x.doc?.body?.innerHTML.slice(0, 80)), shown: view.containerEl.isShown?.(), size: [view.contentEl.clientWidth, view.contentEl.clientHeight], renderer: view.engine?.renderer?.localName }) }
      }
      await wait(500)
      const span = doc.querySelector('.textLayer span')
      const range = doc.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 6)
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      await wait(200)
      step('ask'); askIcon(view).click()
      const id = await until(() => view.model.highlights.find((h) => h.discussion)?.discussion, 8000)
      step('asked')
      const bubble = !!(await until(() => view.engine.renderer.getContents().map((c) => c.doc).find((d) => d?.querySelector('.abele-marks__bubble')), 5000))
      step('drawn')
      await closeChat()
      return { id, bubble }
    `))
    expect(asked.error).toBeUndefined()
    expect(asked.bubble).toBe(true)
    const tapped = run<{ error?: string; tapped?: string | null; note?: string }>(`
      const leaf = app.workspace.getLeavesOfType('abele-book')[0]
      const view = leaf.view
      const page = view.engine.renderer.getContents().map((c) => c.doc).find((d) => d?.querySelector('.abele-marks__bubble'))
      const box = page.querySelector('.abele-marks__box').getBoundingClientRect()
      page.elementFromPoint(box.left + 2, box.top + box.height / 2)?.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, view: page.defaultView, clientX: box.left + 2, clientY: box.top + box.height / 2 }))
      const tapped = await until(() => comments.open.value, 5000)
      await closeChat()
      leaf.detach()
      return { tapped, note: await read(${JSON.stringify(PDF_NOTE)}) }
    `)
    expect(tapped.error).toBeUndefined()
    expect(tapped.tapped).toBe(asked.id)
    expect(tapped.note).toMatch(/> \[!chat\] .*plain\.pdf#cfi=.* · .*\.abchat/)
  })

  it('on a phone: the marked words and the panel, pictured', async () => {
    await reload('app.emulateMobile(true)')
    await setWindowSize(390, 844)
    await reload('window.location.reload()')
    const r = run<{ error?: string; bubble?: boolean; items?: number }>(`
      app.workspace.rightSplit.collapse()
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await selectIn(view, 1, 0, 25)
      askIcon(view).click()
      await until(() => view.model.highlights.find((h) => h.discussion), 8000)
      await closeChat(); app.workspace.rightSplit.collapse()
      view.reading.clearSelection(); view.model.active = null
      await wait(800)
      const overlay = view.engine.renderer.getContents()[0].overlayer?.element
      const bubble = !!overlay?.querySelector('.abele-discussion-bubble')
      await shoot('phone-marked')
      view.model.panelTab = 'highlights'; view.model.panel = true
      await wait(700)
      await shoot('phone-panel')
      const items = view.contentEl.querySelectorAll('.abele-book-highlights__item').length
      view.model.panel = false
      leaf.detach()
      return { bubble, items }
    `)
    expect(r.error).toBeUndefined()
    expect(r.bubble).toBe(true)
    expect(r.items).toBeGreaterThan(0)
  }, 240_000)
})
