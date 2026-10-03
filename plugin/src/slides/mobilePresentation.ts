import type { FullscreenHost } from './core/model'

interface MobileWindow {
  Capacitor?: {
    Plugins?: {
      StatusBar?: {
        getInfo(): Promise<{ visible: boolean }>
        hide(): Promise<void>
        show(): Promise<void>
      }
    }
  }
}

/** Phone WebViews have no element fullscreen. Hide native chrome where supported, and restore
 * only what this show changed. Serializing the bridge also covers Escape during a pending hide. */
export function mobilePresentation(win: Window | MobileWindow): FullscreenHost {
  let queue = Promise.resolve()
  let active = false
  let restore = false
  const statusBar = (win as MobileWindow).Capacitor?.Plugins?.StatusBar
  const enqueue = (action: () => Promise<void>) => {
    queue = queue.then(action).catch(() => {
      // The full-window surface still works in apps without this native capability.
    })
    return queue
  }
  return {
    enter: () =>
      enqueue(async () => {
        if (active || !statusBar) return
        const info = await statusBar.getInfo()
        active = true
        restore = info.visible
        if (restore) await statusBar.hide()
      }),
    exit: () =>
      enqueue(async () => {
        if (!active || !statusBar) return
        active = false
        if (restore) {
          restore = false
          await statusBar.show()
        }
      }),
  }
}
