/**
 * The task and transaction dialogs, in the running app, with Obsidian's own note editor inside.
 *
 * That editor is borrowed from Obsidian's insides (see `src/editor/embeddedEditor.ts`). The
 * first test here is the alarm: it fails the moment an Obsidian update moves what is borrowed,
 * so a broken dialog is found here rather than on the owner's phone, where the buttons would
 * quietly fall back to opening notes.
 *
 * The rest checks what a component test cannot: that the field is the real editor in live
 * preview, that a link in it is drawn as a link and a tap on it does not open the note behind
 * the dialog, that `[[` brings up Obsidian's own suggester above the dialog, that none of the
 * plugin's own editor additions — the task header, galleries — draws inside it, and that saving
 * writes the note. Notes written here are removed after each test.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw } from './helpers/obsidianCli'

const available = isObsidianRunning() && hasTestApi()

const run = <T>(body: string, timeoutMs = 60_000): T =>
  JSON.parse(
    evalRaw(
      `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const closeDialogs = async () => {
    for (let i = 0; i < 4 && document.querySelector('.modal'); i++) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      await wait(200)
    }
  }
  const viewOf = (modal) => {
    return window.__abeleTest.formEditorView(modal.querySelector('.abele-note-editor-field__editor'))
  }
  ${body}
})()`,
      timeoutMs
    )
  ) as T

const written: string[] = []

describe.skipIf(!available)('entry dialogs', () => {
  beforeAll(() => {
    evalRaw(
      `(() => { for (const m of document.querySelectorAll('.modal')) m.remove(); return 'ok' })()`
    )
  })

  afterEach(() => {
    run<string>(`
      await closeDialogs()
      for (const path of ${JSON.stringify(written)}) {
        const file = app.vault.getFileByPath(path)
        if (file) await app.vault.delete(file)
        // The folders a new note was put in go with it when they are empty: the fixture vault
        // holds ScaleTest/ and nothing else, and a stray folder there moves group membership.
        let folder = path.split('/').slice(0, -1).join('/')
        while (folder && !folder.startsWith('ScaleTest')) {
          const f = app.vault.getAbstractFileByPath(folder)
          if (!f || !f.children || f.children.length) break
          await app.vault.delete(f, true)
          folder = folder.split('/').slice(0, -1).join('/')
        }
      }
      return JSON.stringify('ok')
    `)
    written.length = 0
  })

  it('can still borrow Obsidian’s note editor', () => {
    expect(evalRaw(`String(window.__abeleTest.embeddedEditorAvailable())`)).toBe('true')
  })

  it('puts the real editor in the task dialog, in live preview, with nothing of ours in it', () => {
    const r = run<{
      editor: boolean
      livePreview: boolean
      link: number
      ours: number
      activeBefore: string
      activeAfterClick: string
      text: string
    }>(`
      const activeBefore = app.workspace.getActiveFile()?.path ?? ''
      await window.__abeleTest.openTaskForm({ defaults: { date: '2026-09-26' } })
      await until(() => document.querySelector('.modal .abele-note-editor-field__editor .cm-editor'), 5000)
      const modal = document.querySelector('.modal')
      const view = viewOf(modal)
      view.dispatch({ changes: { from: 0, insert: 'See [[Welcome]] and **bold**\\n\\n---\\ntype: task\\n---' } })
      await wait(500)
      const field = modal.querySelector('.abele-note-editor-field__editor')
      const link = field.querySelectorAll('.cm-hmd-internal-link').length
      // A tap on the link would open the note behind the dialog; it places the cursor instead.
      const linkEl = field.querySelector('.cm-hmd-internal-link')
      if (linkEl) linkEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: linkEl.getBoundingClientRect().left + 2, clientY: linkEl.getBoundingClientRect().top + 2 }))
      await wait(400)
      return JSON.stringify({
        editor: !!field.querySelector('.cm-editor'),
        livePreview: !!field.querySelector('.is-live-preview'),
        link,
        ours: field.querySelectorAll('.abele-task-header-view, .abele-header-view, .abele-gallery, .abele-footer-widget-container').length,
        activeBefore,
        activeAfterClick: app.workspace.getActiveFile()?.path ?? '',
        text: view.state.doc.toString().slice(0, 20),
      })
    `)
    expect(r.editor).toBe(true)
    expect(r.livePreview).toBe(true)
    expect(r.link).toBeGreaterThan(0)
    expect(r.ours).toBe(0)
    expect(r.activeAfterClick).toBe(r.activeBefore)
  })

  it('offers Obsidian’s own link suggester on [[, above the dialog', () => {
    const r = run<{ open: boolean; above: boolean }>(`
      await window.__abeleTest.openTaskForm()
      await until(() => document.querySelector('.modal .abele-note-editor-field__editor .cm-editor'), 5000)
      const modal = document.querySelector('.modal')
      const view = viewOf(modal)
      view.focus()
      // A window behind others never has focus, and the suggester asks for it.
      Object.defineProperty(view, 'hasFocus', { get: () => true, configurable: true })
      view.dispatch({ changes: { from: 0, insert: '[[Sca' }, selection: { anchor: 5 }, userEvent: 'input.type' })
      await wait(300)
      const owner = app.workspace.activeEditor
      if (!document.querySelector('.suggestion-container') && owner && owner.editor) {
        app.workspace.editorSuggest.trigger(owner.editor, null, true)
      }
      const open = await until(() => document.querySelector('.suggestion-container .suggestion-item'), 3000)
      const box = document.querySelector('.suggestion-container')
      const above = !!box && Number(getComputedStyle(box).zIndex || 0) >= Number(getComputedStyle(modal.closest('.modal-container')).zIndex || 0)
      delete view.hasFocus
      app.workspace.editorSuggest.close?.()
      return JSON.stringify({ open, above })
    `)
    expect(r.open).toBe(true)
    expect(r.above).toBe(true)
  })

  it('saves a task written in the dialog as a task note', () => {
    const r = run<{ path: string; raw: string }>(`
      let saved = ''
      await window.__abeleTest.openTaskForm({ defaults: { date: '2026-09-26' } })
      await until(() => document.querySelector('.modal .abele-note-editor-field__editor .cm-editor'), 5000)
      const modal = document.querySelector('.modal')
      const title = modal.querySelector('.abele-entry-form__title')
      title.value = 'Entry form probe task'
      title.dispatchEvent(new Event('input', { bubbles: true }))
      viewOf(modal).dispatch({ changes: { from: 0, insert: 'Details with [[ScaleTest]]' } })
      await wait(200)
      const save = [...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save')
      save.click()
      await until(() => !document.querySelector('.modal'), 5000)
      const file = await (async () => {
        for (let i = 0; i < 30; i++) {
          const f = app.vault.getMarkdownFiles().find((x) => x.basename === 'Entry form probe task')
          if (f) return f
          await wait(100)
        }
        return null
      })()
      return JSON.stringify({ path: file ? file.path : '', raw: file ? await app.vault.read(file) : '' })
    `)
    if (r.path) written.push(r.path)
    expect(r.path).not.toBe('')
    expect(r.raw).toContain('type: task')
    expect(r.raw).toMatch(/date: '?2026-09-26'?/)
    expect(r.raw).toContain('Entry form probe task\nDetails with [[ScaleTest]]')
  })

  it('saves a transaction and starts the next one on the same day', () => {
    const r = run<{ paths: string[]; raw: string; stillOpen: boolean; date: string }>(`
      await window.__abeleTest.openTransactionForm({ defaults: { date: '2026-09-20' } })
      await until(() => document.querySelector('.modal .abele-transaction-form .cm-editor'), 5000)
      const modal = document.querySelector('.modal')
      const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
      set(modal.querySelector('.abele-entry-form__title'), 'Entry form probe coffee')
      set(modal.querySelector('.abele-amount-field__input'), '3 + 0.5')
      await wait(100)
      const next = [...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next')
      next.click()
      await wait(1000)
      const stillOpen = !!document.querySelector('.modal .abele-transaction-form')
      const date = [...modal.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => /\\d\\d\\.\\d\\d\\.\\d{4}/.test(t)) || ''
      const files = app.vault.getMarkdownFiles().filter((x) => x.basename.startsWith('Entry form probe'))
      const raw = files[0] ? await app.vault.read(files[0]) : ''
      return JSON.stringify({ paths: files.map((f) => f.path), raw, stillOpen, date })
    `)
    written.push(...r.paths)
    expect(r.paths.length).toBe(1)
    expect(r.raw).toContain('type: transaction')
    expect(r.raw).toContain('amount: 3.5')
    expect(r.stillOpen).toBe(true)
    expect(r.date).toBe('20.09.2026')
  })
})
