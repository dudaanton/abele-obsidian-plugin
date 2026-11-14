import { ViewPlugin, type EditorView } from '@codemirror/view'
import type { Plugin } from 'obsidian'
import {
  COLUMN_FLIGHT_FLAG,
  columnFlight,
  createColumnFlight,
  setColumnFlight,
  type ColumnFlightRecorder,
} from './flight'

/** Installed only after the harness explicitly enables recording for this page load. */
export function registerColumnFlight(plugin: Plugin): void {
  let deactivate: (() => void) | undefined
  const activate = () => {
    let recorder: ColumnFlightRecorder | undefined
    try {
      if (
        window.localStorage.getItem(COLUMN_FLIGHT_FLAG) !== String(window.performance.timeOrigin)
      ) {
        deactivate?.()
        return
      }
      if (columnFlight) return
      recorder = createColumnFlight(window.localStorage, String(window.performance.timeOrigin))
    } catch {
      return
    }
    if (!recorder) return
    const active = recorder
    const watches = new Set<() => void>()
    let enabled = true
    setColumnFlight(active)
    active.checkpoint('flight.start')
    plugin.registerEditorExtension(
      ViewPlugin.fromClass(
        class {
          private stop: () => void = () => {}
          constructor(view: EditorView) {
            if (!enabled) return
            active.view('view.plugin.create', view)
            this.stop = watchColumnFlightView(view, active)
            watches.add(this.stop)
          }
          update(update: import('@codemirror/view').ViewUpdate): void {
            if (enabled) active.view('view.plugin.update', update.view)
          }
          destroy(): void {
            this.stop()
            watches.delete(this.stop)
          }
        }
      )
    )
    deactivate = () => {
      enabled = false
      for (const stop of watches) stop()
      watches.clear()
      if (columnFlight === active) setColumnFlight(undefined)
      active.destroy()
    }
    plugin.register(deactivate)
  }
  // A same-page storage event lets the harness enable diagnostics without reloading the editor.
  plugin.registerDomEvent(window, 'storage', (event) => {
    if (event.key === COLUMN_FLIGHT_FLAG || event.key === null) activate()
  })
  activate()
}

/** Passive observers and instance-local hooks; never modify the host prototypes. */
export function watchColumnFlightView(
  view: EditorView,
  recorder: ColumnFlightRecorder
): () => void {
  const cleanups: (() => void)[] = []
  const target = view as unknown as Record<string, unknown>
  const requests = new WeakMap<object, object>()
  let updateDepth = 0
  let stopped = false
  const requestProxy = (request: object) => {
    let wrapped = requests.get(request)
    if (!wrapped) {
      // A separate target also permits wrapping frozen callbacks without changing their receiver.
      wrapped = new Proxy(
        {},
        {
          get(_target, key) {
            const value: unknown = Reflect.get(request, key, request)
            if ((key !== 'read' && key !== 'write') || typeof value !== 'function') return value
            return function (...args: unknown[]) {
              if (stopped) return Reflect.apply(value, request, args)
              recorder.view(`measure.${key}.in`, view)
              try {
                return Reflect.apply(value, request, args)
              } finally {
                recorder.view(`measure.${key}.out`, view)
              }
            }
          },
        }
      )
      requests.set(request, wrapped)
    }
    return wrapped
  }
  const patch = (object: Record<string, unknown>, key: string, site: string, boundary = false) => {
    const original = object[key]
    if (typeof original !== 'function') return
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const insideUpdate = updateDepth > 0 || Number(target.updateState ?? 0) > 0
      const detail =
        key === 'requestMeasure' && insideUpdate
          ? new Error().stack?.split('\n').slice(1, 7).join('\n').slice(0, 1200)
          : undefined
      recorder.view(
        key === 'dispatch' && insideUpdate ? 'dispatch.in-update' : `${site}.in`,
        view,
        detail
      )
      // A synchronous stall cannot deliver the heartbeat or the remaining batch of records.
      // Persist both sides of update stages so the surviving tail identifies the exact boundary.
      if (boundary || insideUpdate) recorder.flush()
      if (key === 'update') updateDepth++
      try {
        const request = args[0]
        if (key === 'requestMeasure' && request && typeof request === 'object')
          args = [requestProxy(request), ...args.slice(1)]
        return Reflect.apply(original, this, args)
      } finally {
        if (key === 'update') updateDepth--
        recorder.view(`${site}.out`, view)
        if (boundary || insideUpdate) recorder.flush()
      }
    }
    try {
      Object.defineProperty(
        object,
        key,
        descriptor
          ? { ...descriptor, value: wrapped }
          : { configurable: true, writable: true, value: wrapped }
      )
      cleanups.push(() => {
        if (object[key] !== wrapped) return
        if (descriptor) Object.defineProperty(object, key, descriptor)
        else Reflect.deleteProperty(object, key)
      })
    } catch {
      recorder.view(`${site}.hook-unavailable`, view)
    }
  }
  patch(target, 'update', 'view.update', true)
  patch(target, 'dispatch', 'dispatch', true)
  patch(target, 'requestMeasure', 'measure.request')
  patch(target, 'measure', 'measure', true)
  patch(target, 'updatePlugins', 'view.plugins', true)
  patch(target, 'updateAttrs', 'view.attrs', true)
  const nested = (key: string, methods: [string, string][]) => {
    const object = target[key]
    if (!object || typeof object !== 'object') return
    for (const [method, site] of methods)
      patch(object as Record<string, unknown>, method, site, true)
  }
  nested('inputState', [['update', 'input.update']])
  nested('docView', [
    ['update', 'doc.update'],
    ['updateDeco', 'doc.decorations'],
    ['updateInner', 'doc.redraw'],
    ['updateSelection', 'doc.selection'],
  ])
  const win = view.dom.ownerDocument.defaultView
  if (win?.ResizeObserver) {
    const resize = new win.ResizeObserver(() => {
      if (!stopped) recorder.view('observer.resize', view)
    })
    resize.observe(view.dom)
    resize.observe(view.contentDOM ?? view.dom)
    cleanups.push(() => resize.disconnect())
  }
  if (win?.MutationObserver) {
    const mutation = new win.MutationObserver(() => {
      if (!stopped) recorder.view('observer.mutation', view)
    })
    mutation.observe(view.dom, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })
    cleanups.push(() => mutation.disconnect())
  }
  return () => {
    if (stopped) return
    stopped = true
    recorder.view('view.destroy', view)
    for (const cleanup of cleanups.reverse()) cleanup()
  }
}
