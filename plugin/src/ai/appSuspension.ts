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

  heartbeat(): void {
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
  doc.addEventListener('visibilitychange', visibility)
  doc.addEventListener('resume', show)
  win.addEventListener('pagehide', hide)
  win.addEventListener('pageshow', show)
  return () => {
    win.clearInterval(heartbeat)
    doc.removeEventListener('visibilitychange', visibility)
    doc.removeEventListener('resume', show)
    win.removeEventListener('pagehide', hide)
    win.removeEventListener('pageshow', show)
    lifecycle.destroy()
  }
}
