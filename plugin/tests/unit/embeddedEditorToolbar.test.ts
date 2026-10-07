import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Scope, type App } from 'obsidian'
import {
  createEmbeddedEditor,
  resetEmbeddedEditorCache,
  type EmbeddedEditor,
} from '@/editor/embeddedEditor'

let field: EmbeddedEditor | null = null
afterEach(() => {
  field?.destroy()
  field = null
  document.body.replaceChildren()
  resetEmbeddedEditorCache()
})
class NoteEditor {
  editor: { cm: EditorView; focus(): void }
  scope = new Scope()
  constructor(
    _app: App,
    host: HTMLElement,
    public owner: unknown
  ) {
    const cm = new EditorView({
      parent: host,
      state: EditorState.create({ extensions: this.buildLocalExtensions() }),
    })
    this.editor = { cm, focus: () => cm.focus() }
  }
  buildLocalExtensions(): Extension[] {
    return []
  }
  set(value: string) {
    this.editor.cm.dispatch({
      changes: { from: 0, to: this.editor.cm.state.doc.length, insert: value },
    })
  }
  get() {
    return this.editor.cm.state.doc.toString()
  }
  onUpdate() {}
  unload() {
    this.editor.cm.destroy()
  }
}
function open() {
  const workspace = {
    activeEditor: null as { editor: { cm: EditorView } } | null,
    on: vi.fn(),
    offref: vi.fn(),
  }
  const app = {
    workspace,
    keymap: { pushScope: vi.fn(), popScope: vi.fn() },
    mobileToolbar: { update: vi.fn() },
    embedRegistry: {
      embedByExtension: {
        md: () => ({
          editable: false,
          showEditor() {},
          editMode: Object.create(Object.create(NoteEditor.prototype)),
          unload() {},
        }),
      },
    },
  } as unknown as App
  const host = document.createElement('div')
  document.body.append(host)
  field = createEmbeddedEditor(app, host, { value: 'sample words', onSubmit() {} })
  field!.focus()
  return { workspace, owner: workspace.activeEditor, host }
}
describe('embedded editor toolbar ownership', () => {
  it('keeps formatting on the field through a toolbar-induced blur, then releases normal blur', async () => {
    const m = open()
    expect(m.owner).not.toBeNull()
    const toolbar = document.createElement('div')
    toolbar.className = 'mobile-toolbar'
    const bold = document.createElement('button')
    toolbar.append(bold)
    document.body.append(toolbar)
    let target: unknown
    bold.addEventListener('click', () => {
      target = m.workspace.activeEditor
      const cm = m.workspace.activeEditor!.editor.cm
      cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: '**sample words**' } })
      cm.focus()
    })
    bold.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    field!.contentEl.blur()
    bold.click()
    await Promise.resolve()
    expect(target).toBe(m.owner)
    expect(field!.get()).toBe('**sample words**')
    field!.contentEl.blur()
    expect(m.workspace.activeEditor).toBeNull()
  })
  it('lets a cancelled toolbar press release a field that no longer has focus', async () => {
    const m = open()
    const toolbar = document.createElement('div')
    toolbar.className = 'mobile-toolbar'
    document.body.append(toolbar)
    toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    field!.contentEl.blur()
    toolbar.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
    await Promise.resolve()
    expect(m.workspace.activeEditor).toBeNull()
  })
})
