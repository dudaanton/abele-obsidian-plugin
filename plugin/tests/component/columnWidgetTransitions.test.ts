import { expect, it, vi } from 'vitest'
import { EditorState, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { editorInfoField, editorLivePreviewField, MarkdownRenderer, type Plugin } from 'obsidian'
import { registerColumnWidgets } from '@/columns/widget'
import { createColumns } from '@/columns/operations'

it('keeps one outer widget when replacing nested columns with a rejected first inner frame', () => {
  const old = createColumns(createColumns('Inner passage', 'two'), 'two') + '\n\nAfter.\n'
  const text =
    createColumns(
      createColumns('First', 'two').replace('\n', '\n> <!-- annotation -->\n') +
        '\n\n' +
        createColumns('Second', 'two'),
      'two'
    ) + '\n\nAfter.\n'
  let extension: Extension = []
  registerColumnWidgets({
    app: {},
    registerEditorExtension: (value: Extension) => {
      extension = value
    },
  } as Plugin)
  class Native extends WidgetType {
    toDOM() {
      const dom = document.createElement('div')
      dom.className = 'sample-native-callout'
      return dom
    }
  }
  const nativeRanges = (state: EditorState) =>
    Decoration.set([
      Decoration.replace({ block: true, widget: new Native() }).range(
        0,
        state.doc.toString().indexOf('\n\nAfter.')
      ),
    ])
  const native = StateField.define({
    create: nativeRanges,
    update: (_value, tr) => nativeRanges(tr.state),
    provide: (field) => EditorView.decorations.from(field),
  })
  const render = vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue()
  const parent = document.createElement('div')
  parent.style.width = '393px'
  document.body.append(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: old,
      extensions: [editorLivePreviewField.init(() => true), editorInfoField, extension, native],
    }),
  })
  try {
    // The editor replaces the document, then moves the caret outside the callout.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    view.dispatch({ selection: { anchor: text.length } })
    expect(render).toHaveBeenCalledOnce()
    expect(render.mock.calls[0][1]).toBe(text.slice(0, text.indexOf('\n\nAfter.')))
    expect(view.contentDOM.querySelectorAll('.abele-columns-editor-widget')).toHaveLength(1)
    expect(view.contentDOM.querySelector('.sample-native-callout')).toBeNull()
  } finally {
    view.destroy()
    parent.remove()
    render.mockRestore()
  }
})
