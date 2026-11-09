import { expect, it, vi } from 'vitest'
import { EditorState, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { editorInfoField, editorLivePreviewField, MarkdownRenderer, type Plugin } from 'obsidian'
import { registerColumns } from '@/columns/register'
import { registerColumnWidgets } from '@/columns/widget'
import { createColumns } from '@/columns/operations'

vi.mock('obsidian', async (original) => {
  const api = await original<typeof import('obsidian')>()
  return {
    ...api,
    ButtonComponent: class extends api.ButtonComponent {
      setIcon() {
        return this
      }
    },
  }
})

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

it('replaces an already rendered rejected-first-frame document with identical source', () => {
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
  const render = vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue()
  const updates = vi.fn()
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      selection: { anchor: text.length },
      extensions: [
        editorLivePreviewField.init(() => true),
        editorInfoField,
        extension,
        EditorView.updateListener.of(updates),
      ],
    }),
  })
  try {
    view.dispatch({ changes: { from: 0, to: text.length, insert: text } })
    expect(updates).toHaveBeenCalledOnce()
    expect(view.state.doc.toString()).toBe(text)
    expect(view.contentDOM.querySelectorAll('.abele-columns-editor-widget')).toHaveLength(1)
    expect(render).toHaveBeenCalledOnce()
  } finally {
    view.destroy()
    parent.remove()
    render.mockRestore()
  }
})

it('finishes replacement with column postprocessing and provenance binding enabled', async () => {
  const text =
    createColumns(
      createColumns('First', 'two').replace('\n', '\n> <!-- annotation -->\n') +
        '\n\n' +
        createColumns('Second', 'two'),
      'two'
    ) + '\n\nAfter.\n'
  const callout = (type: string, children: Node[] = []) => {
    const root = document.createElement('div')
    root.className = 'callout'
    root.dataset.callout = type
    const title = root.createDiv({ cls: 'callout-title' })
    title.textContent = type
    root.createDiv({ cls: 'callout-content' }).append(...children)
    return root
  }
  const frame = (children: Node[]) => {
    const root = callout('abele-columns', [
      callout('abele-column', children),
      callout('abele-column'),
    ])
    root.dataset.calloutMetadata = 'ratio=1:1 mobile=stack'
    return root
  }
  const paragraph = (text: string) => {
    const element = document.createElement('p')
    element.textContent = text
    return element
  }
  let extension: Extension = []
  let process!: import('obsidian').MarkdownPostProcessor
  registerColumns({
    app: { workspace: { on: () => ({}) } },
    registerEditorExtension: (value: Extension) => {
      extension = value
    },
    registerMarkdownPostProcessor: (value: import('obsidian').MarkdownPostProcessor) => {
      process = value
    },
    registerDomEvent: () => {},
    registerEvent: () => {},
    addCommand: () => {},
  } as unknown as Plugin)
  const render = vi
    .spyOn(MarkdownRenderer, 'render')
    .mockImplementation(async (_app, _text, el, _path, owner) => {
      const first = frame([paragraph('First')])
      first.querySelector('.callout-content')!.prepend(document.createComment(' annotation '))
      el.replaceChildren(frame([first, frame([paragraph('Second')])]))
      await process(el, {
        getSectionInfo: () => null,
        addChild: (child) => owner.addChild(child),
      } as unknown as import('obsidian').MarkdownPostProcessorContext)
    })
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      selection: { anchor: text.length },
      extensions: [editorLivePreviewField.init(() => true), editorInfoField, extension],
    }),
  })
  try {
    view.dispatch({ changes: { from: 0, to: text.length, insert: text } })
    expect(render).toHaveBeenCalledOnce()
    await render.mock.results[0].value
    expect(view.contentDOM.querySelectorAll('.abele-columns')).toHaveLength(3)
    expect(view.contentDOM.querySelectorAll('.abele-columns-controls')).toHaveLength(3)
  } finally {
    view.destroy()
    parent.remove()
    render.mockRestore()
  }
})
