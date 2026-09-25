/**
 * Copying a key from a screen, and saying what became of it.
 *
 * One place for every screen that copies a key — the list of all keys and each field a key is
 * entered in — so they all clear the clipboard the same way and say so in the same words.
 */
import { Notice } from 'obsidian'
import { copySecret, platformClipboard } from './clipboard'

/** `win` is the window the screen is in: settings can be a window of their own. */
export async function copyKey(text: string, what: string, win: Window): Promise<void> {
  try {
    const { clears } = await copySecret(text, platformClipboard(win))
    new Notice(
      clears
        ? `${what} copied. It is cleared from the clipboard in a minute.`
        : `${what} copied. It stays on the clipboard until something else is copied.`
    )
  } catch (e) {
    // The failure, never the text that was being copied.
    console.error('[Abele] a key could not be copied', (e as Error)?.message)
    new Notice('The clipboard refused it: nothing was copied.')
  }
}
