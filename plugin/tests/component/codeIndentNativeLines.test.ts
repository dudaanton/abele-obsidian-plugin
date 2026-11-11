import { expect, it, vi } from 'vitest'
import 'obsidian'
import type { Plugin } from 'obsidian'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type MeasureRequest } from '@codemirror/view'
import { codeGuideExtension, registerCodeIndentGuides } from '@/codeIndent/register'
import { nativeCodeLines } from '@/codeIndent/nativeLines'

it('preserves fractional layout insets and measures the entire leading indent', () => {
  const row = document.createElement('div')
  row.className = 'cm-line HyperMD-codeblock-bg abele-code-guides'
  row.style.cssText = 'padding-inline-start: 45.5px; text-indent: -29.25px'
  row.textContent = '    child'
  const contentDOM = document.createElement('div')
  contentDOM.append(row)
  document.body.append(contentDOM)
  const bounds = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return new DOMRect(36, 20, this.endOffset - this.startOffset === 4 ? 29.25 : 7, 20)
  })
  const rowBounds = vi
    .spyOn(row, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(20, 20, 400, 20))
  try {
    const view = { contentDOM, state: EditorState.create({ doc: '    child' }), posAtDOM: () => 0 }
    const result = nativeCodeLines(view as unknown as EditorView, 4, () => 'code')
    expect(result.metrics.get(1)).toEqual({ cell: 7.3125, inset: 16.25 })
  } finally {
    bounds.mockRestore()
    rowBounds.mockRestore()
    contentDOM.remove()
  }
})

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
  const bounds = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return new DOMRect(36, 20, 7 * (this.endOffset - this.startOffset), 20)
  })
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
    expect(view.plugin(guides).guideDiagnostics()).toMatchObject({
      internalEnabled: true,
      decorationCount: 3,
      lastRecomputed: { enabled: true, measured: true },
    })
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
      vault: { getConfig: (key: string) => config[key], on: vi.fn() },
      workspace: {
        on: vi.fn(),
        onLayoutReady: vi.fn(),
        iterateAllLeaves: (visit: (leaf: unknown) => void) =>
          visit({ view: { editor: { cm: view } } }),
      },
    },
    registerEditorExtension: (extension: Extension) => extensions.push(extension),
    registerMarkdownPostProcessor: vi.fn(),
    registerInterval: vi.fn(),
    registerEvent: vi.fn(),
    register: vi.fn(),
    registerDomEvent: vi.fn(),
  }
  try {
    registerCodeIndentGuides(host as unknown as Plugin)
    expect(extensions).toHaveLength(1)
    expect(host.registerDomEvent).toHaveBeenCalledTimes(1)
    expect(host.app.workspace.onLayoutReady).toHaveBeenCalledTimes(1)
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
    // Mobile has the same config source, but need not provide a native body class.
    document.body.classList.add('is-mobile')
    const configChanged = host.app.vault.on.mock.calls.find(
      ([event]) => event === 'config-changed'
    )[1] as (key: string) => void
    config.showIndentGuide = false
    configChanged('showIndentGuide')
    expect(view.contentDOM.querySelector('.abele-code-guides')).toBeNull()
    delete config.showIndentGuide
    configChanged('showIndentGuide')
    expect(view.contentDOM.querySelectorAll('.abele-code-guides')).toHaveLength(3)
    expect(
      view.plugin(registered as ReturnType<typeof codeGuideExtension>).guideDiagnostics()
    ).toMatchObject({
      internalEnabled: true,
      currentGate: {
        rawConfig: '[undefined]',
        rawConfigType: 'undefined',
        gateReturn: true,
        inputUsed: 'vault-config-default-on',
        editorDocument: { mainDocument: true, mobile: true, observed: true },
        observerDocuments: [expect.objectContaining({ mainDocument: true, observed: true })],
      },
    })
    const dispatch = vi.spyOn(view, 'dispatch')
    const ready = host.app.workspace.onLayoutReady.mock.calls[0][0] as () => void
    ready()
    expect(dispatch).toHaveBeenCalled()
    dispatch.mockRestore()
  } finally {
    document.body.classList.remove('is-mobile')
    document.body.classList.remove('show-indentation-guide')
    for (const [cleanup] of host.register.mock.calls) (cleanup as () => void)()
    view?.destroy()
    interval.mockRestore()
    measure.mockRestore()
  }
})
