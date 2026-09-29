/**
 * The one door into the note places from code that scrolls a note: kept apart from
 * `register.ts` so importing it brings in nothing else.
 */
import type { MarkdownView } from 'obsidian'

interface Claims {
  claim(view: MarkdownView): void
}

let keeper: Claims | null = null

/** Set by `registerNotePlaces`, and back to null at the plugin's unload. */
export function setPlaceKeeper(k: Claims | null): void {
  keeper = k
}

export function currentPlaceKeeper(): Claims | null {
  return keeper
}

/**
 * `view` is being taken to a place of the caller's own: its saved place is not to be put back
 * over it. Called by everything in the plugin that opens a note and then scrolls it.
 */
export function holdNotePlace(view: MarkdownView): void {
  keeper?.claim(view)
}
