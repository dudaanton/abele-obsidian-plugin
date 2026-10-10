import { createApp, type App as VueApp, type Component } from 'vue'

export interface ComponentDialog {
  /** Settles once the component has mounted, or the cancelled load has finished. */
  ready: Promise<void>
  close(this: void): void
}
const open = new Set<ComponentDialog>()
const keyed = new Map<string, ComponentDialog>()

/** On-demand Vue content using the kit's own modal, not a flag in the plugin root. */
export function openComponentDialog(
  load: () => Promise<Component>,
  props: Record<string, unknown> = {},
  options: {
    key?: string
    document?: Document
    onClosed?: (error?: unknown) => void
  } = {}
): ComponentDialog {
  const existing = options.key ? keyed.get(options.key) : null
  if (existing) return existing
  const doc =
    options.document ?? (typeof activeDocument === 'undefined' ? document : activeDocument)
  let container: HTMLElement | null = null
  let vue: VueApp | null = null
  let closed = false
  let mounting = false
  const dispose = () => {
    vue?.unmount()
    vue = null
    container?.remove()
    container = null
  }
  const close = (error?: unknown) => {
    if (closed) return
    closed = true
    open.delete(handle)
    if (options.key) keyed.delete(options.key)
    // Vue marks an app mounted only after its mounted hooks return. A close emitted by
    // one of those hooks must wait to dispose it, or its unmount hooks never run.
    if (!mounting) dispose()
    options.onClosed?.(error)
  }
  const handle: ComponentDialog = {
    ready: Promise.resolve(),
    close: () => close(),
  }
  open.add(handle)
  if (options.key) keyed.set(options.key, handle)
  handle.ready = Promise.resolve()
    .then(load)
    .then((component) => {
      if (closed) return
      container = doc.win.createDiv()
      container.dataset.abeleDialogHost = ''
      doc.body.appendChild(container)
      vue = createApp(component, { ...props, onClose: handle.close })
      mounting = true
      try {
        vue.mount(container)
      } finally {
        mounting = false
        if (closed) dispose()
      }
    })
    .catch((error: unknown) => {
      close(error)
      throw error
    })
  return handle
}

/** Includes pending imports; none may put a dialog back after plugin unload. */
export function closeComponentDialogs(): void {
  // Closing a queued form opens the next, which must be closed in this same teardown.
  while (open.size) [...open][0].close()
}
