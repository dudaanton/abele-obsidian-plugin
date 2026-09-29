/**
 * The chat's composer is Obsidian's note editor, and while it has the focus it is Obsidian's
 * active editor — the one editor commands and the phone's toolbar work on. Only while it has the
 * focus: once the person is back in their note, a command from the palette or a hotkey acts on
 * the note, not on the composer they typed in a moment ago.
 *
 * It did not give the place back. The composer took the active editor on focus and kept it after
 * losing the focus, so with the chat used last, "Insert image gallery" wrote its header into the
 * chat's field instead of the note on screen.
 *
 * A note is opened, the composer is typed into, and then the focus goes elsewhere two ways. Into
 * the note itself: an editor command — Obsidian's own bold — then changes the note and leaves the
 * composer as it was. And nowhere in particular, which is what the command palette does to it:
 * the composer is then no longer the active editor, and the command leaves it alone. (Where the
 * chat's own pane is the active one, Obsidian has no note to offer either, as with any sidebar.) The window's focus is emulated, since the tier's window is rarely in front
 * and a field focused behind others gets no focus events.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalLong,
  hasTestApi,
  isObsidianRunning,
  setBackgroundThrottling,
  setFocusEmulation,
} from './helpers/obsidianCli'

const NOTE = 'composer-active-probe.md'
const TYPED = 'typed in the chat'

interface Case {
  note: string
  composer: string
  activeIsComposer: boolean
  error: string
}

const probe = (how: 'note' | 'nowhere') => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = { note: '', composer: '', activeIsComposer: false, error: '' }
  let leaf = null
  try {
    const stale = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
    if (stale) await app.vault.delete(stale)
    const file = await app.vault.create(${JSON.stringify(NOTE)}, 'plain words')
    leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file, { active: true })
    await wait(400)

    await window.__abeleTest.ChatService.getInstance().revealSidebar()
    await wait(600)
    const chat = [...document.querySelectorAll('.abele-ai-chat')].filter((e) => e.getClientRects().length).at(-1)
    const composer = window.__abeleTest.composer(chat)
    if (!composer) throw new Error('no composer on screen')
    composer.focus()
    composer.set(${JSON.stringify(TYPED)})
    await wait(300)
    if (app.workspace.activeEditor?.editor?.cm !== window.__abeleTest.noteFieldView(composer.field))
      throw new Error('the composer did not become the active editor while focused')

    ${
      how === 'note'
        ? `app.workspace.setActiveLeaf(leaf, { focus: true })
    leaf.view.editor.focus()`
        : `document.activeElement.blur()`
    }
    await wait(300)

    const noteEditor = leaf.view.editor
    noteEditor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 })
    app.commands.executeCommandById('editor:toggle-bold')
    await wait(300)
    out.note = noteEditor.getValue()
    out.composer = composer.get()
    out.activeIsComposer = app.workspace.activeEditor?.editor?.cm === window.__abeleTest.noteFieldView(composer.field)
    composer.set('')
  } catch (e) {
    out.error = String((e && e.message) || e)
  } finally {
    if (leaf) leaf.detach()
    await wait(200)
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
    if (f) await app.vault.delete(f)
  }
  return JSON.stringify(out)
})()`

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('an editor command after the chat composer was used', () => {
  let backInNote: Case
  let focusGone: Case

  beforeAll(async () => {
    setBackgroundThrottling(false)
    setFocusEmulation(true)
    backInNote = JSON.parse(await evalLong(probe('note'), 60_000)) as Case
    focusGone = JSON.parse(await evalLong(probe('nowhere'), 60_000)) as Case
  }, 180_000)

  afterAll(() => {
    if (!available) return
    setFocusEmulation(false)
    setBackgroundThrottling(true)
  })

  it('acts on the note once the person is back in it', () => {
    expect(backInNote.error).toBe('')
    expect(backInNote.note).toBe('**plain** words')
    expect(backInNote.composer).toBe(TYPED)
    expect(backInNote.activeIsComposer).toBe(false)
  })

  it('leaves the composer alone once it has lost the focus, as to the command palette', () => {
    expect(focusGone.error).toBe('')
    expect(focusGone.composer).toBe(TYPED)
    expect(focusGone.activeIsComposer).toBe(false)
  })
})
