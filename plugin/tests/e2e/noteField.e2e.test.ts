/**
 * The note field — Obsidian's own note editor standing in a form — in the running app.
 *
 * That editor is borrowed from Obsidian's insides (see `src/editor/embeddedEditor.ts`). The
 * first test is the alarm: it fails the moment an Obsidian update moves what is borrowed, so a
 * field that fell back to a plain text box is found here rather than on the owner's phone.
 *
 * The rest checks what a component test cannot, through a script's form with a `note` field:
 * that the field is the real editor in live preview, that a link in it is drawn as a link and a
 * tap on it does not open the note behind the dialog, that `[[` brings up Obsidian's own
 * suggester above the dialog, and that the form answers with the markdown written. Then, on a
 * phone (390×844 under `emulateMobile`), that Obsidian's toolbar above the keyboard comes up
 * for the field, over the dialog, and stays up when something takes the active editor away
 * while the field keeps its focus.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw, evalJson, runCli } from './helpers/obsidianCli'

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
  const openForm = async (fields) => {
    window.__noteFieldAnswer = undefined
    window.__abeleTest.showFormModal(fields).then((v) => { window.__noteFieldAnswer = v })
    await until(() => document.querySelector('.modal .abele-note-editor-field__editor .cm-editor'), 5000)
    return document.querySelector('.modal')
  }
  const viewOf = (modal) =>
    window.__abeleTest.noteFieldView(modal.querySelector('.abele-note-editor-field__editor'))
  ${body}
})()`,
      timeoutMs
    )
  ) as T

const closeDialogs = () =>
  run<string>(`
    for (let i = 0; i < 4 && document.querySelector('.modal'); i++) {
      const cancel = [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Cancel')
      if (cancel) cancel.click()
      else document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      await wait(200)
    }
    return JSON.stringify('ok')
  `)

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const reload = async (how: string): Promise<void> => {
  evalRaw(`(() => { setTimeout(() => { ${how} }, 50); return 'ok' })()`, 30_000)
  await pause(4000)
  const deadline = Date.now() + 60_000
  while (!hasTestApi() && Date.now() < deadline) await pause(1000)
  runCli(['dev:debug', 'on'], 30_000)
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

const NOTE_FIELD = `[{ name: 'body', label: 'Body', type: 'note', default: '' }]`

describe.skipIf(!available)('the note field', () => {
  beforeAll(() => {
    evalRaw(
      `(() => { for (const m of document.querySelectorAll('.modal')) m.remove(); return 'ok' })()`
    )
  })

  afterEach(() => {
    closeDialogs()
  })

  it('can still borrow Obsidian’s note editor', () => {
    expect(evalRaw(`String(window.__abeleTest.embeddedEditorAvailable())`)).toBe('true')
  })

  it('is the real editor, in live preview, and a tap on a link stays in the form', () => {
    const r = run<{
      livePreview: boolean
      link: number
      activeBefore: string
      activeAfterClick: string
      stillOpen: boolean
    }>(`
      const activeBefore = app.workspace.getActiveFile()?.path ?? ''
      const modal = await openForm(${NOTE_FIELD})
      viewOf(modal).dispatch({ changes: { from: 0, insert: 'See [[Welcome]] and **bold**' } })
      await wait(500)
      const field = modal.querySelector('.abele-note-editor-field__editor')
      const link = field.querySelectorAll('.cm-hmd-internal-link').length
      const linkEl = field.querySelector('.cm-hmd-internal-link')
      if (linkEl) {
        const box = linkEl.getBoundingClientRect()
        linkEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: box.left + 2, clientY: box.top + 2 }))
      }
      await wait(400)
      return JSON.stringify({
        livePreview: !!field.querySelector('.is-live-preview'),
        link,
        activeBefore,
        activeAfterClick: app.workspace.getActiveFile()?.path ?? '',
        stillOpen: !!document.querySelector('.modal .abele-note-editor-field'),
      })
    `)
    expect(r.livePreview).toBe(true)
    expect(r.link).toBeGreaterThan(0)
    expect(r.activeAfterClick).toBe(r.activeBefore)
    expect(r.stillOpen).toBe(true)
  })

  it('offers Obsidian’s own link suggester on [[, above the dialog', () => {
    const r = run<{ open: boolean; above: boolean }>(`
      const modal = await openForm(${NOTE_FIELD})
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

  it('answers the form with the markdown written in it', () => {
    const r = run<{ answer: Record<string, string> | null }>(`
      const modal = await openForm(${NOTE_FIELD})
      viewOf(modal).dispatch({ changes: { from: 0, insert: '- [ ] call [[Anna]]\\n**soon**' } })
      await wait(200)
      ;[...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run').click()
      await until(() => window.__noteFieldAnswer !== undefined, 3000)
      return JSON.stringify({ answer: window.__noteFieldAnswer ?? null })
    `)
    expect(r.answer).toEqual({ body: '- [ ] call [[Anna]]\n**soon**' })
  })

  describe('on a phone', () => {
    let size: [number, number] = [0, 0]

    beforeAll(async () => {
      size = evalJson<[number, number]>(
        `require('@electron/remote').getCurrentWindow().getContentSize()`
      )
      await reload('app.emulateMobile(true)')
      await setWindowSize(390, 844)
    }, 240_000)

    afterAll(async () => {
      closeDialogs()
      if (size[0]) await setWindowSize(size[0], size[1])
      await reload('app.emulateMobile(false)')
    }, 180_000)

    /** Whether the toolbar is up, and whether what is at its middle is the toolbar itself. */
    const TOOLBAR = `
      const toolbar = () => {
        const el = document.querySelector('.mobile-toolbar')
        const box = el && el.getBoundingClientRect()
        const hit = box && box.height ? document.elementFromPoint(box.left + 40, box.top + box.height / 2) : null
        return { up: !!app.mobileToolbar?.isVisible, onTop: !!(hit && hit.closest('.mobile-toolbar')) }
      }
    `

    it('brings up Obsidian’s toolbar for the field, over the dialog', () => {
      const r = run<{
        phone: boolean
        before: { up: boolean }
        typing: { up: boolean; onTop: boolean }
        after: { up: boolean }
      }>(`
        ${TOOLBAR}
        const modal = await openForm(${NOTE_FIELD})
        await wait(300)
        const before = toolbar()
        viewOf(modal).focus()
        await wait(500)
        const typing = toolbar()
        viewOf(modal).contentDOM.blur()
        await wait(500)
        return JSON.stringify({ phone: app.isMobile, before, typing, after: toolbar() })
      `)
      expect(r.phone).toBe(true)
      expect(r.before.up).toBe(false)
      expect(r.typing).toEqual({ up: true, onTop: true })
      expect(r.after.up).toBe(false)
    })

    it('keeps the toolbar up when a leaf becoming active takes the active editor away', () => {
      const r = run<{ up: boolean; ours: boolean }>(`
        ${TOOLBAR}
        const modal = await openForm(${NOTE_FIELD})
        const view = viewOf(modal)
        view.focus()
        await wait(400)
        // What \`setActiveLeaf\` does to it, with the field still holding the focus.
        app.workspace.activeEditor = null
        app.workspace.trigger('active-leaf-change', app.workspace.activeLeaf)
        app.mobileToolbar.update()
        await wait(400)
        return JSON.stringify({
          up: toolbar().up,
          ours: app.workspace.activeEditor?.editor?.cm === view,
        })
      `)
      expect(r).toEqual({ up: true, ours: true })
    })
  })
})
