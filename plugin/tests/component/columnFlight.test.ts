import { afterEach, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { Plugin } from 'obsidian'
import { editorInfoField, editorLivePreviewField, MarkdownRenderer } from 'obsidian'
import { EditorState } from '@codemirror/state'
import { registerColumnWidgets } from '@/columns/widget'
import { createColumns } from '@/columns/operations'
import {
  COLUMN_FLIGHT_BUFFER,
  COLUMN_FLIGHT_FLAG,
  createColumnFlight,
  columnFlight,
} from '@/columns/flight'
import { registerColumnFlight, watchColumnFlightView } from '@/columns/flightEditor'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('persists the exact nested redraw boundary before it can block the page', () => {
  const values = new Map([[COLUMN_FLIGHT_FLAG, 'sample-load']])
  const recorder = createColumnFlight(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
    },
    'sample-load',
    { now: () => 1000, schedule: () => () => {} }
  )!
  const tail = () => JSON.parse(values.get(COLUMN_FLIGHT_BUFFER)!).entries.at(-1)
  const failure = new Error('sample blocked redraw')
  const widget = {
    toDOM() {
      expect(this).toBe(widget)
      expect(tail().site).toBe('redraw.widget.1.toDOM.in')
      return document.createElement('div')
    },
  }
  const originalWidgetDOM = widget.toDOM
  const inner = vi.fn(function (this: unknown) {
    expect(this).toBe(docView)
    expect(tail().site).toBe('doc.redraw.in')
    const detail = JSON.parse(tail().detail)
    expect(detail.ranges).toEqual([
      {
        set: 0,
        from: 0,
        to: 100,
        block: true,
        startSide: -1,
        endSide: 1,
        widget: 1,
        type: 'Object',
        decorationType: 'Object',
      },
    ])
    expect(detail.selection).toEqual({ anchor: 123, head: 123 })
    expect(detail.repeated).toBe(true)
    expect(detail.brokenParent).toBe(true)
    expect(detail.tiles).toHaveLength(2)
    widget.toDOM()
    throw failure
  })
  const docView = {
    tile: (() => {
      const root: { length: number; children: unknown[] } = { length: 123, children: [] }
      const leaf = { length: 100, widget }
      root.children = [leaf, leaf, root]
      return root
    })(),
    decorations: [
      {
        between(_from: number, _to: number, visit: (...args: unknown[]) => void) {
          visit(0, 100, { block: true, startSide: -1, endSide: 1, widget })
        },
      },
    ],
    updateInner: inner,
    update() {
      return this.updateInner()
    },
  }
  const view = {
    dom: document.createElement('div'),
    state: { doc: { length: 123 }, selection: { main: { anchor: 123, head: 123 } } },
    viewport: { from: 0, to: 123 },
    docView,
    update() {
      return docView.update()
    },
  }
  const stop = watchColumnFlightView(view as unknown as EditorView, recorder)
  try {
    expect(() => view.update()).toThrow(failure)
    expect(tail().site).toBe('view.update.out')
    expect(widget.toDOM).toBe(originalWidgetDOM)
  } finally {
    stop()
    recorder.destroy()
  }
  expect(docView.updateInner).toBe(inner)
})

it('does not install view instrumentation, observers or timers when disabled', () => {
  const extension = vi.fn()
  const timer = vi.spyOn(window, 'setInterval')
  const resize = vi.fn()
  vi.stubGlobal('ResizeObserver', resize)
  registerColumnFlight({
    registerDomEvent: vi.fn(),
    registerEditorExtension: extension,
  } as unknown as Plugin)
  expect(columnFlight).toBeUndefined()
  expect(extension).not.toHaveBeenCalled()
  expect(resize).not.toHaveBeenCalled()
  expect(timer).not.toHaveBeenCalled()
  expect(window.localStorage.getItem(COLUMN_FLIGHT_BUFFER)).toBeNull()
})

it('activates from the harness flag, checkpoints immediately and cleans up on unload', () => {
  let activate!: () => void
  let unload!: () => void
  const extension = vi.fn()
  registerColumnFlight({
    registerDomEvent: (
      _window: Window,
      _event: string,
      listener: (event: StorageEvent) => void
    ) => {
      activate = () => listener(new StorageEvent('storage', { key: COLUMN_FLIGHT_FLAG }))
    },
    registerEditorExtension: extension,
    register: (listener: () => void) => {
      unload = listener
    },
  } as unknown as Plugin)
  window.localStorage.setItem(COLUMN_FLIGHT_FLAG, String(performance.timeOrigin))
  activate()
  try {
    expect(extension).toHaveBeenCalledOnce()
    expect(columnFlight).toBeDefined()
    expect(JSON.parse(window.localStorage.getItem(COLUMN_FLIGHT_BUFFER)!).entries[0].site).toBe(
      'flight.start'
    )
    activate()
    expect(extension).toHaveBeenCalledOnce()
    window.localStorage.removeItem(COLUMN_FLIGHT_FLAG)
    activate()
    expect(columnFlight).toBeUndefined()
  } finally {
    unload()
  }
  expect(columnFlight).toBeUndefined()
})

it('preserves measure request identity, callback receivers, return values and thrown errors', () => {
  const values = new Map([[COLUMN_FLIGHT_FLAG, 'sample-load']])
  const recorder = createColumnFlight(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
    },
    'sample-load',
    { now: () => 1000, schedule: () => () => {} }
  )!
  const requests: {
    key?: object
    read(view: unknown): unknown
    write(value: unknown, view: unknown): void
  }[] = []
  const originalDispatch = vi.fn(function (this: unknown, value: unknown) {
    return [this, value]
  })
  const originalUpdate = vi.fn(() => view.dispatch('nested'))
  const originalMeasure = vi.fn(() => 7)
  const originalRequest = vi.fn((request) => {
    if (request) requests.push(request)
  })
  const view = {
    dom: document.createElement('div'),
    state: { doc: { length: 42 } },
    viewport: { from: 0, to: 42 },
    update: originalUpdate,
    dispatch: originalDispatch,
    measure: originalMeasure,
    requestMeasure: originalRequest,
  }
  let resize!: () => void
  let mutation!: () => void
  const disconnectResize = vi.fn(),
    disconnectMutation = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect = disconnectResize
    }
  )
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: () => void) {
        mutation = callback
      }
      observe() {}
      disconnect = disconnectMutation
    }
  )
  const stop = watchColumnFlightView(view as unknown as EditorView, recorder)
  try {
    expect(view.measure()).toBe(7)
    expect(view.update()).toEqual([view, 'nested'])
    const request = {
      key: {},
      read: vi.fn(function (this: unknown, received: unknown) {
        expect(this).toBe(request)
        expect(received).toBe(view)
        return 17
      }),
      write: vi.fn(function (this: unknown, value: unknown, received: unknown) {
        expect(this).toBe(request)
        expect(value).toBe(17)
        expect(received).toBe(view)
      }),
    }
    view.requestMeasure(request)
    view.requestMeasure(request)
    expect(requests[0]).toBe(requests[1])
    expect(requests[0].key).toBe(request.key)
    expect(requests[0].read(view)).toBe(17)
    requests[0].write(17, view)
    const failure = new Error('sample read failure')
    request.read.mockImplementation(() => {
      throw failure
    })
    expect(() => requests[0].read(view)).toThrow(failure)
    const frozen = Object.freeze({
      read() {
        return this
      },
    })
    view.requestMeasure(frozen)
    expect(requests[2].read(view)).toBe(frozen)
    resize()
    mutation()
  } finally {
    stop()
    recorder.destroy()
  }
  const entries = JSON.parse(values.get(COLUMN_FLIGHT_BUFFER)!).entries
  expect(entries.map((entry: { site: string }) => entry.site)).toEqual(
    expect.arrayContaining([
      'view.update.in',
      'dispatch.in-update',
      'measure.in',
      'measure.out',
      'measure.request.in',
      'measure.read.in',
      'measure.read.out',
      'measure.write.in',
      'measure.write.out',
      'observer.resize',
      'observer.mutation',
    ])
  )
  expect(
    entries.every(
      (entry: { docLen: number; viewportTo: number }) =>
        entry.docLen === 42 && entry.viewportTo === 42
    )
  ).toBe(true)
  expect(view.dispatch).toBe(originalDispatch)
  expect(view.update).toBe(originalUpdate)
  expect(view.measure).toBe(originalMeasure)
  expect(view.requestMeasure).toBe(originalRequest)
  expect(disconnectResize).toHaveBeenCalledOnce()
  expect(disconnectMutation).toHaveBeenCalledOnce()
})

it('stops existing hooks and does not hook new editors after the flag is removed', () => {
  let activate!: () => void
  let unload!: () => void
  let extension!: Extension
  registerColumnFlight({
    registerDomEvent: (
      _window: Window,
      _event: string,
      listener: (event: StorageEvent) => void
    ) => {
      activate = () => listener(new StorageEvent('storage', { key: COLUMN_FLIGHT_FLAG }))
    },
    registerEditorExtension: (value: Extension) => {
      extension = value
    },
    register: (listener: () => void) => {
      unload = listener
    },
  } as unknown as Plugin)
  window.localStorage.setItem(COLUMN_FLIGHT_FLAG, String(performance.timeOrigin))
  activate()
  const first = new EditorView({ doc: 'Sample', extensions: [extension] })
  let second: EditorView | undefined
  try {
    expect(Object.hasOwn(first, 'measure')).toBe(true)
    window.localStorage.removeItem(COLUMN_FLIGHT_FLAG)
    activate()
    expect(Object.hasOwn(first, 'measure')).toBe(false)
    second = new EditorView({ doc: 'Sample', extensions: [extension] })
    expect(Object.hasOwn(second, 'measure')).toBe(false)
  } finally {
    first.destroy()
    second?.destroy()
    unload()
  }
})

it('records real column rebuild and widget lifecycles without changing document edits', () => {
  const extensions: Extension[] = []
  let unload!: () => void
  const plugin = {
    app: {},
    registerDomEvent: vi.fn(),
    registerEditorExtension: (value: Extension) => {
      extensions.push(value)
    },
    register: (listener: () => void) => {
      unload = listener
    },
  } as unknown as Plugin
  window.localStorage.setItem(COLUMN_FLIGHT_FLAG, String(performance.timeOrigin))
  registerColumnFlight(plugin)
  registerColumnWidgets(plugin)
  vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue()
  const text = createColumns('Sample body', 'two') + '\n\nAfter.\n'
  const view = new EditorView({
    state: EditorState.create({
      doc: text,
      selection: { anchor: text.length },
      extensions: [editorInfoField, editorLivePreviewField.init(() => true), ...extensions],
    }),
  })
  try {
    const next = text.replace('Sample body', 'Changed body')
    view.dispatch({ changes: { from: 0, to: text.length, insert: next } })
    expect(view.state.doc.toString()).toBe(next)
    expect(view.contentDOM.querySelectorAll('.abele-columns-editor-widget')).toHaveLength(1)
    view.setState(view.state)
    view.dispatch({ selection: { anchor: next.length } })
    expect(Object.hasOwn((view as unknown as { docView: object }).docView, 'update')).toBe(true)
  } finally {
    view.destroy()
    unload()
  }
  const saved = JSON.parse(window.localStorage.getItem(COLUMN_FLIGHT_BUFFER)!)
  expect(saved.entries.map((entry: { site: string }) => entry.site)).toEqual(
    expect.arrayContaining([
      'decorations.build.in',
      'decorations.build.out',
      'field.update.in',
      'field.update.out',
      'widget.toDOM.in',
      'widget.toDOM.out',
      'widget.destroy.in',
      'widget.destroy.out',
      'view.plugin.create',
      'view.plugin.update',
      'dispatch.in',
      'doc.update.in',
      'doc.redraw.in',
      'doc.selection.out',
    ])
  )
})
