import type { FullscreenHost } from './core/model'

interface StatusBarBridge {
  getInfo(): Promise<{ visible: boolean }>
  hide(): Promise<void>
  show(): Promise<void>
}

interface MobileWindow {
  Capacitor?: { Plugins?: { StatusBar?: StatusBarBridge } }
}

interface ChromeOwnership {
  update(owner: symbol, active: boolean): Promise<void>
}

// Replacement viewers have separate lifetimes, but operate on the same native chrome.
// Windows and native bridges are weak keys so closed windows do not stay alive here.
const windows = new WeakMap<object, WeakMap<StatusBarBridge, ChromeOwnership>>()

function ownership(win: object, bridge: StatusBarBridge): ChromeOwnership {
  let bridges = windows.get(win)
  if (!bridges) windows.set(win, (bridges = new WeakMap()))
  const existing = bridges.get(bridge)
  if (existing) return existing

  const owners = new Set<symbol>()
  let queue = Promise.resolve()
  let baseline: boolean | undefined
  let hidden = false
  let changed = false
  const reconcile = async () => {
    for (;;) {
      if (owners.size) {
        if (baseline === undefined) baseline = (await bridge.getInfo()).visible
        if (!owners.size) continue
        if (baseline && !hidden) {
          // Even a rejected acknowledgement may have changed the native UI.
          changed = true
          await bridge.hide()
          hidden = true
        }
        if (!owners.size) continue
        return
      }
      if (baseline === undefined) return
      if (baseline && changed) {
        hidden = false
        // Exit/destroy may be the last update ever. Retry a transient rejection once,
        // but never reveal chrome over a new owner that entered during the request.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await bridge.show()
            changed = false
            break
          } catch (error) {
            if (owners.size) break
            if (attempt === 1) throw error
          }
        }
      }
      // A new viewer may have entered while native restoration was already in flight.
      // Keep the original baseline and hide again before releasing the shared queue.
      if (owners.size) continue
      baseline = undefined
      hidden = false
      return
    }
  }
  const shared: ChromeOwnership = {
    update(owner, active) {
      // Publish ownership synchronously, before any outgoing native request can settle.
      if (active) owners.add(owner)
      else owners.delete(owner)
      queue = queue.then(reconcile).catch(() => {
        // Missing/rejected capability must not break the overlay. Preserve restoration
        // state on failure so a later exit can retry instead of losing the baseline.
      })
      return queue
    },
  }
  bridges.set(bridge, shared)
  return shared
}

/** Phone WebViews have no element fullscreen. All viewers in a window share native chrome
 * ownership, serialization and one original visibility snapshot until the last show exits. */
export function mobilePresentation(win: Window | MobileWindow): FullscreenHost {
  const bridge = (win as MobileWindow).Capacitor?.Plugins?.StatusBar
  if (
    !bridge ||
    typeof bridge.getInfo !== 'function' ||
    typeof bridge.hide !== 'function' ||
    typeof bridge.show !== 'function'
  )
    return { enter: async () => {}, exit: async () => {} }
  const shared = ownership(win, bridge)
  const owner = Symbol('presentation chrome')
  return {
    enter: () => shared.update(owner, true),
    exit: () => shared.update(owner, false),
  }
}
