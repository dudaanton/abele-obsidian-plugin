/**
 * The size Obsidian's settings window opens at on a desktop.
 *
 * Since Obsidian draws its settings in a window of their own, it asks for 900×700 whatever the
 * screen, and does not remember a size the user dragged it to. Beside Obsidian's list of tabs and
 * the plugin's own list of pages that leaves a plugin's settings a strip under 500px wide. The
 * plugin asks for up to 1280×1000 instead, 90% × 88% of a smaller screen, never less than Obsidian
 * asked for unless the screen is smaller than that, and puts it where Obsidian would — centred over
 * the main window — moved back onto the screen when that would push it past an edge.
 *
 * Only the size and place Obsidian asks for change: its minimum size, and everything drawn inside
 * the window, are its own. The in-app dialog, drawn when that window is switched off, is sized in
 * the stylesheet.
 */

/** What Obsidian's `getPopoutOptions` returns for a window a modal opens in. */
export interface PopoutOptions {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  x?: number
  y?: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const SETTINGS_WINDOW_MAX = { width: 1280, height: 1000 }
export const SETTINGS_WINDOW_SHARE = { width: 0.9, height: 0.88 }

const OBSIDIAN_DEFAULT = { width: 900, height: 700 }

/** One side of the window: as much of the screen's share as the cap allows, held on it. */
function side(asked: number, available: number, max: number, share: number): number {
  return Math.min(available, Math.max(asked, Math.min(max, Math.floor(available * share))))
}

const within = (start: number, size: number, from: number, room: number): number =>
  Math.max(from, Math.min(start, from + room - size))

/**
 * The window Obsidian should open: `asked` is what it asked for, `main` the main window's outer
 * rectangle, `screen` the part of its screen windows may cover.
 */
export function settingsWindowBounds(
  asked: PopoutOptions,
  main: Rect,
  screen: Rect
): PopoutOptions & Rect {
  const width = side(
    asked.width ?? OBSIDIAN_DEFAULT.width,
    screen.width,
    SETTINGS_WINDOW_MAX.width,
    SETTINGS_WINDOW_SHARE.width
  )
  const height = side(
    asked.height ?? OBSIDIAN_DEFAULT.height,
    screen.height,
    SETTINGS_WINDOW_MAX.height,
    SETTINGS_WINDOW_SHARE.height
  )
  const x = Math.round(main.x + (main.width - width) / 2)
  const y = Math.round(main.y + (main.height - height) / 2)
  return {
    ...asked,
    width,
    height,
    x: within(x, width, screen.x, screen.width),
    y: within(y, height, screen.y, screen.height),
  }
}

/** The part of the window `enlargeSettingsWindow` reads: where it stands, and its screen. */
export interface MainWindow {
  screenX: number
  screenY: number
  outerWidth: number
  outerHeight: number
  screen: { availLeft?: number; availTop?: number; availWidth: number; availHeight: number }
}

/**
 * Makes Obsidian's settings (`app.setting`) ask for the larger window, read from `win` at the
 * moment they open. Returns the undo, which gives Obsidian its own method back. An Obsidian whose
 * settings have no window of their own is left as it is.
 */
export function enlargeSettingsWindow(setting: object, win: MainWindow): () => void {
  const target = setting as { getPopoutOptions?: () => PopoutOptions }
  const original = target.getPopoutOptions
  if (typeof original !== 'function') return () => {}
  const own = Object.prototype.hasOwnProperty.call(target, 'getPopoutOptions')

  target.getPopoutOptions = function (this: unknown) {
    const asked = original.call(this)
    try {
      const s = win.screen
      return settingsWindowBounds(
        asked,
        { x: win.screenX, y: win.screenY, width: win.outerWidth, height: win.outerHeight },
        { x: s.availLeft ?? 0, y: s.availTop ?? 0, width: s.availWidth, height: s.availHeight }
      )
    } catch (e) {
      console.error('[Abele] settings window size', (e as Error)?.message)
      return asked
    }
  }

  return () => {
    if (own) target.getPopoutOptions = original
    else delete target.getPopoutOptions
  }
}
