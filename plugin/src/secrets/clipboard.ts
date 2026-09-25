/**
 * Copying a key, and taking it off the clipboard again.
 *
 * A key left on the clipboard is readable by every app on the device, and on an Apple device
 * by every other device signed in to the same account (Universal Clipboard). So a minute after
 * a copy, the clipboard is read back and emptied if it still holds that key — never otherwise,
 * so whatever the person copied since is left alone.
 *
 * That needs the clipboard to be readable without asking. On the desktop Electron reads it
 * freely. On a phone it is not: iOS asks the person to allow pasting every time an app reads
 * the clipboard, and a system prompt appearing a minute after a copy, out of nowhere, is worse
 * than the risk it guards against — Android behaves much the same. There the key stays until
 * something else is copied, and the notice says so.
 */
import { Platform } from 'obsidian'

export const CLEAR_AFTER_MS = 60_000

export interface SecretClipboard {
  write(text: string): Promise<void>
  /** `null` where the clipboard cannot be read back without asking the person. */
  read: (() => Promise<string>) | null
}

interface ElectronClipboard {
  readText(): string
  writeText(text: string): void
}

function electronClipboard(): ElectronClipboard | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is only reachable through require, and only on the desktop
    const electron = require('electron') as { clipboard?: ElectronClipboard }
    return electron.clipboard ?? null
  } catch {
    return null
  }
}

/** The clipboard of the window the screen is in. */
export function platformClipboard(win: Window): SecretClipboard {
  const electron = Platform.isDesktopApp ? electronClipboard() : null
  if (electron) {
    return {
      write: async (text) => electron.writeText(text),
      read: async () => electron.readText(),
    }
  }
  return {
    write: (text) => win.navigator.clipboard.writeText(text),
    // Electron's own clipboard from the page is deprecated (it warns on first use); should it
    // go, the desktop reads through the page's clipboard, which Electron allows unasked but
    // only while the window has focus — a read refused then leaves the key where it is.
    read: Platform.isDesktopApp ? () => win.navigator.clipboard.readText() : null,
  }
}

/**
 * Copies `text`, and clears it after a minute if it is still there.
 * `clears` says whether that will happen, for the notice.
 */
export async function copySecret(
  text: string,
  clipboard: SecretClipboard
): Promise<{ clears: boolean }> {
  await clipboard.write(text)
  const read = clipboard.read
  if (!read) return { clears: false }

  // Deliberately not tied to the screen: the key is on the clipboard whether or not the
  // dialog it was copied from is still open.
  window.setTimeout(() => {
    void (async () => {
      try {
        if ((await read()) === text) await clipboard.write('')
      } catch {
        // Cannot be read now: left as it is rather than cleared blind, which could wipe
        // something the person copied since.
      }
    })()
  }, CLEAR_AFTER_MS)
  return { clears: true }
}
