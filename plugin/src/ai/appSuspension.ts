/** A host reports background/foreground edges; requests subscribe only for their own lifetime. */
export class AppSuspension {
  enabled = false
  hidden = false
  frozenOnReturn = false
  private lastHeartbeat = Date.now()
  private backgroundGap = false
  private listeners = new Set<() => void>()

  setHidden(hidden: boolean): void {
    if (!this.enabled || this.hidden === hidden) return
    this.frozenOnReturn =
      !hidden && (this.backgroundGap || Date.now() - this.lastHeartbeat >= 10_000)
    this.backgroundGap = false
    this.lastHeartbeat = Date.now()
    this.hidden = hidden
    for (const listener of [...this.listeners]) listener()
  }

  /** Some WebViews never hide the document. A timer gap still proves a suspended JS host. */
  recoverIfFrozen(): boolean {
    if (!this.enabled || this.hidden || Date.now() - this.lastHeartbeat < 10_000) return false
    this.setHidden(true)
    this.backgroundGap = true
    this.setHidden(false)
    return true
  }

  heartbeat(): void {
    this.recoverIfFrozen()
    const now = Date.now()
    if (this.hidden && now - this.lastHeartbeat >= 10_000) this.backgroundGap = true
    this.lastHeartbeat = now
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  waitForReturn(signal?: AbortSignal): Promise<boolean> {
    if (!this.enabled || signal?.aborted) return Promise.resolve(false)
    if (!this.hidden) return Promise.resolve(true)
    return new Promise((resolve) => {
      const finish = (ready: boolean) => {
        unsubscribe()
        signal?.removeEventListener('abort', aborted)
        resolve(ready)
      }
      const aborted = () => finish(false)
      const unsubscribe = this.subscribe(() => {
        if (!this.enabled || !this.hidden) finish(this.enabled && !signal?.aborted)
      })
      signal?.addEventListener('abort', aborted, { once: true })
    })
  }

  destroy(): void {
    this.enabled = false
    this.hidden = false
    this.frozenOnReturn = false
    this.backgroundGap = false
    for (const listener of [...this.listeners]) listener()
    this.listeners.clear()
  }
}

export const appSuspension = new AppSuspension()

interface NativeListener {
  remove(): void | Promise<void>
}
interface NativeApp {
  addListener(
    event: 'appStateChange',
    listener: (state: { isActive: boolean }) => void
  ): NativeListener | Promise<NativeListener>
}

/** Thin WebView adapter. No listeners are installed on desktop. */
export function bindAppSuspension(
  lifecycle: AppSuspension,
  doc: Document,
  win: Window
): () => void {
  lifecycle.enabled = true
  lifecycle.heartbeat()
  const heartbeat = win.setInterval(() => lifecycle.heartbeat(), 1000)
  lifecycle.setHidden(doc.visibilityState === 'hidden')
  const visibility = () => lifecycle.setHidden(doc.visibilityState === 'hidden')
  const hide = () => lifecycle.setHidden(true)
  const show = () => lifecycle.setHidden(false)
  let disposed = false
  let nativeListener: NativeListener | null = null
  const nativeState = (state: { isActive: boolean }) => {
    if (!disposed && typeof state.isActive === 'boolean') lifecycle.setHidden(!state.isActive)
  }
  const stateEvent = (event: Event) => {
    const state = (event as CustomEvent<{ isActive?: boolean }>).detail
    if (typeof state?.isActive === 'boolean') nativeState({ isActive: state.isActive })
  }
  const removeNative = (listener: NativeListener) => {
    void Promise.resolve(listener.remove()).catch(() => {})
  }
  // Capacitor's native app state can change while document.visibilityState remains visible.
  const native = (win as Window & { Capacitor?: { Plugins?: { App?: NativeApp } } }).Capacitor
    ?.Plugins?.App
  if (native?.addListener) {
    try {
      void Promise.resolve(native.addListener('appStateChange', nativeState))
        .then((listener) => {
          if (disposed) removeNative(listener)
          else nativeListener = listener
        })
        .catch(() => {})
    } catch {
      /* Older hosts may expose a plugin proxy without implementing the App plugin. */
    }
  }
  doc.addEventListener('visibilitychange', visibility)
  doc.addEventListener('pause', hide)
  doc.addEventListener('resume', show)
  win.addEventListener('pause', hide)
  win.addEventListener('resume', show)
  win.addEventListener('appStateChange', stateEvent)
  win.addEventListener('pagehide', hide)
  win.addEventListener('pageshow', show)
  return () => {
    if (disposed) return
    disposed = true
    win.clearInterval(heartbeat)
    if (nativeListener) removeNative(nativeListener)
    nativeListener = null
    doc.removeEventListener('visibilitychange', visibility)
    doc.removeEventListener('pause', hide)
    doc.removeEventListener('resume', show)
    win.removeEventListener('pause', hide)
    win.removeEventListener('resume', show)
    win.removeEventListener('appStateChange', stateEvent)
    win.removeEventListener('pagehide', hide)
    win.removeEventListener('pageshow', show)
    lifecycle.destroy()
  }
}
