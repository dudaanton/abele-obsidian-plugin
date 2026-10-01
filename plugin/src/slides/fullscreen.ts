import { Platform } from 'obsidian'
import type { FullscreenHost } from './core/model'

interface NativeWindow {
  isFullScreen(): boolean
  setFullScreen(on: boolean): void
  isSimpleFullScreen?(): boolean
  setSimpleFullScreen?(on: boolean): void
  on(event: 'leave-full-screen' | 'resize', handler: () => void): void
  removeListener(event: 'leave-full-screen' | 'resize', handler: () => void): void
}

/** The embedded app can leave DOM/native-space fullscreen pending. Simple mode fills the display
 * on macOS without creating another Space; other desktops use their regular window fullscreen. */
export function nativeFullscreen(win: NativeWindow, preferSimple = false): FullscreenHost {
  const simple = preferSimple && !!win.setSimpleFullScreen && !!win.isSimpleFullScreen
  const isFullscreen = () => win.isFullScreen() || !!win.isSimpleFullScreen?.()
  const set = (on: boolean) => {
    if (simple) win.setSimpleFullScreen!(on)
    else win.setFullScreen(on)
  }
  let entered = false,
    wasFullscreen = false
  return {
    async enter() {
      if (entered) return
      wasFullscreen = isFullscreen()
      entered = true
      if (!wasFullscreen) set(true)
    },
    async exit() {
      if (!entered) return
      entered = false
      if (!wasFullscreen) set(false)
    },
    watchExited(exited) {
      const event = simple ? 'resize' : 'leave-full-screen'
      const handler = simple
        ? () => {
            if (entered && !isFullscreen()) exited()
          }
        : exited
      win.on(event, handler)
      return () => win.removeListener(event, handler)
    },
  }
}

/** Resolve in the tab's own renderer realm, so a desktop popout controls only its own window. */
export function desktopFullscreen(host: HTMLElement): FullscreenHost | undefined {
  if (Platform.isMobile) return undefined
  const win = host.ownerDocument.defaultView as unknown as {
    require?: (name: string) => { getCurrentWindow(): NativeWindow }
  }
  try {
    const native = win.require?.('@electron/remote').getCurrentWindow()
    return native ? nativeFullscreen(native, Platform.isMacOS) : undefined
  } catch {
    return undefined
  }
}
