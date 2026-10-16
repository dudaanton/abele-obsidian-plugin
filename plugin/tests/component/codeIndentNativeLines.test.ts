import { expect, it, vi } from 'vitest'
import 'obsidian'
import type { Plugin } from 'obsidian'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type MeasureRequest } from '@codemirror/view'
import { codeGuideExtension, registerCodeIndentGuides } from '@/codeIndent/register'

const DOC = 'prose\n```js\nroot\n  child\n\n    deep\n```\n  prose'
// Obsidian's line/background decorators and token spans need not have equivalent
// public syntax-tree node names. This editor deliberately has no HyperMD parser.
const native = StateField.define({
  create(state) {
    const classes = [
      '',
      'HyperMD-codeblock-bg HyperMD-codeblock-begin',
      'HyperMD-codeblock-bg',
      'HyperMD-codeblock-bg',
      'HyperMD-codeblock-bg',
      'HyperMD-codeblock-bg',
      'HyperMD-codeblock-bg HyperMD-codeblock-end',
    ]
    const marks = classes.flatMap((cls, index) => {
      if (!cls) return []
      const line = state.doc.line(index + 1)
      const row = Decoration.line({ class: cls }).range(line.from)
      return line.length && index > 1 && index < 6
        ? [
            row,
            Decoration.mark({
              class: 'cm-hmd-codeblock',
              attributes: { style: 'font-family: monospace; font-size: 14px' },
            }).range(line.from, line.to),
          ]
        : [row]
    })
    return Decoration.set(marks, true)
  },
  update(value, transaction) {
    return value.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

it('decorates native background/token lines after measurement without parser-name assumptions', async () => {
  const requests: MeasureRequest<unknown>[] = []
  const measure = vi.spyOn(EditorView.prototype, 'requestMeasure').mockImplementation((request) => {
    if (request) requests.push(request)
  })
  const bounds = vi
    .spyOn(Range.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(36, 20, 7, 20))
  const originalBounds = HTMLElement.prototype.getBoundingClientRect
  const rowsBounds = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function () {
      return this.classList.contains('cm-line')
        ? new DOMRect(20, 20, 400, 20)
        : originalBounds.call(this)
    })
  const guides = codeGuideExtension(() => ({ enabled: true, tabSize: 4 }))
  const view = new EditorView({
    state: EditorState.create({ doc: DOC, extensions: [native, guides] }),
  })
  const flush = async () => {
    const request = requests.filter((r) => r.key === view.plugin(guides)).at(-1)
    request.write(request.read(view), view)
    await Promise.resolve()
  }
  try {
    await flush()
    const rows = () =>
      Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.abele-code-guides'))
    expect(rows().map((row) => row.style.getPropertyValue('--abele-guide-depth'))).toEqual([
      '1',
      '1',
      '2',
    ])
    expect(rows()[0].style.getPropertyValue('--abele-guide-step')).toBe('14px')
    expect(rows()[0].style.getPropertyValue('--abele-guide-inset')).toBe('16px')
    expect(rows()[0].classList.contains('HyperMD-codeblock-bg')).toBe(true)
    expect(rows()[0].classList.contains('HyperMD-codeblock')).toBe(false)
    view.dispatch({ selection: { anchor: 0, head: DOC.length } })
    await flush()
    view.dispatch({ selection: { anchor: DOC.indexOf('deep') } })
    await flush()
    expect(rows()).toHaveLength(3)
    expect(view.state.doc.toString()).toBe(DOC)
    expect(view.state.selection.main.head).toBe(DOC.indexOf('deep'))
    expect(
      view.contentDOM.querySelectorAll('.cm-line:not(.HyperMD-codeblock-bg).abele-code-guides')
    ).toHaveLength(0)
  } finally {
    view.destroy()
    rowsBounds.mockRestore()
    bounds.mockRestore()
    measure.mockRestore()
  }
})

it('keeps the registered extension through vault setting changes and editor reconfiguration', async () => {
  const extensions: Extension[] = []
  const config: Record<string, unknown> = {}
  let tick: () => void
  let view: EditorView
  const interval = vi.spyOn(window, 'setInterval').mockImplementation((callback: TimerHandler) => {
    tick = callback as () => void
    return 1
  })
  const requests: MeasureRequest<unknown>[] = []
  const measure = vi.spyOn(EditorView.prototype, 'requestMeasure').mockImplementation((request) => {
    if (request) requests.push(request)
  })
  const host = {
    app: {
      vault: { getConfig: (key: string) => config[key] },
      workspace: {
        on: vi.fn(),
        iterateAllLeaves: (visit: (leaf: unknown) => void) =>
          visit({ view: { editor: { cm: view } } }),
      },
    },
    registerEditorExtension: (extension: Extension) => extensions.push(extension),
    registerMarkdownPostProcessor: vi.fn(),
    registerInterval: vi.fn(),
    registerEvent: vi.fn(),
    register: vi.fn(),
  }
  try {
    registerCodeIndentGuides(host as unknown as Plugin)
    expect(extensions).toHaveLength(1)
    const registered = extensions[0]
    view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [native, extensions] }),
    })
    const flush = async () => {
      const request = requests
        .filter((r) => r.key === view.plugin(registered as ReturnType<typeof codeGuideExtension>))
        .at(-1)
      request.write(request.read(view), view)
      await Promise.resolve()
    }
    await flush()
    expect(config.showIndentGuide).toBeUndefined()
    expect(view.contentDOM.querySelectorAll('.abele-code-guides')).toHaveLength(3)
    // Native list-guide visibility is authoritative even if the config snapshot lags.
    document.body.classList.add('show-indentation-guide')
    config.showIndentGuide = false
    tick()
    expect(view.contentDOM.querySelectorAll('.abele-code-guides')).toHaveLength(3)
    document.body.classList.remove('show-indentation-guide')
    config.showIndentGuide = false
    tick()
    expect(view.contentDOM.querySelector('.abele-code-guides')).toBeNull()
    document.body.classList.add('show-indentation-guide')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.contentDOM.querySelectorAll('.abele-code-guides')).toHaveLength(3)
    document.body.classList.remove('show-indentation-guide')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.contentDOM.querySelector('.abele-code-guides')).toBeNull()
    config.showIndentGuide = true
    config.tabSize = 2
    tick()
    view.dispatch({ effects: StateEffect.reconfigure.of([native, extensions]) })
    await flush()
    expect(extensions[0]).toBe(registered)
    expect(view.contentDOM.querySelectorAll('.abele-code-guides')).toHaveLength(3)
    expect(host.app.vault.getConfig('showIndentGuide')).toBe(true)
  } finally {
    document.body.classList.remove('show-indentation-guide')
    for (const [cleanup] of host.register.mock.calls) (cleanup as () => void)()
    view?.destroy()
    interval.mockRestore()
    measure.mockRestore()
  }
})
