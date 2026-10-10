import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, type DecorationSet, type WidgetType } from '@codemirror/view'
import {
  Component,
  MarkdownRenderer,
  editorLivePreviewField,
  editorInfoField,
  type Plugin,
} from 'obsidian'
import { registerColumnWidgets } from '@/columns/widget'
import { columnContentNote } from '../fixtures/columns/content'

afterEach(() => vi.restoreAllMocks())
function widget() {
  let extension: any
  registerColumnWidgets({
    app: {},
    registerEditorExtension: (value: unknown) => {
      extension = value
    },
  } as Plugin)
  const state = EditorState.create({
    doc: columnContentNote('Sample body'),
    selection: { anchor: 0 },
    extensions: [editorLivePreviewField.init(() => true), editorInfoField, extension],
  })
  let result: WidgetType | null = null
  for (const set of state.facet(EditorView.decorations)) {
    if (typeof set !== 'function')
      (set as DecorationSet).between(0, state.doc.length, (_from, _to, decoration) => {
        result = decoration.spec.widget
      })
  }
  expect(result).not.toBeNull()
  return { widget: result!, state }
}
describe('column widget render lifetime', () => {
  it('unloads present and asynchronously arriving render children on replacement', async () => {
    const { widget: w, state } = widget()
    let finish!: () => void
    let owner!: Component
    const disposed = vi.fn()
    class Resource extends Component {
      onunload() {
        disposed()
      }
    }
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
      async (_app, _text, _el, _path, child) => {
        owner = child as Component
        owner.addChild(new Resource())
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        owner.addChild(new Resource())
      }
    )
    const host = w.toDOM({ dom: document.createElement('div'), state } as EditorView)
    w.destroy(host)
    expect(disposed).toHaveBeenCalledTimes(1)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(disposed).toHaveBeenCalledTimes(2)
  })
  it('owns rejected async rendering without leaving an unhandled rejection', async () => {
    const { widget: w, state } = widget()
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(MarkdownRenderer, 'render').mockRejectedValue(new Error('sample render failure'))
    const host = w.toDOM({ dom: document.createElement('div'), state } as EditorView)
    await Promise.resolve()
    await Promise.resolve()
    expect(host.textContent).toContain('Could not render columns')
    w.destroy(host)
    warning.mockRestore()
  })
})
