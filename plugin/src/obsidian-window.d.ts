/**
 * Obsidian installs its element factories on every window it opens, but its published types
 * declare them only as bare globals — which are bound to the **main** window's document.
 *
 * That distinction matters: `createDiv()` always builds in the main window, while
 * `someDocument.win.createDiv()` builds in that document's own window. Code that has to place
 * an element in the window the user is actually looking at — a settings window, a popped-out
 * note — needs the second form, and without this declaration it does not type-check.
 *
 * Verified against a running Obsidian: in a popout leaf, `doc.win.createDiv()` returns an
 * element whose `ownerDocument` is the popout's document, detached until it is appended.
 */
import 'obsidian'

declare global {
  interface Window {
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      o?: DomElementInfo | string,
      callback?: (el: HTMLElementTagNameMap[K]) => void
    ): HTMLElementTagNameMap[K]
    createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement
    createSpan(
      o?: DomElementInfo | string,
      callback?: (el: HTMLSpanElement) => void
    ): HTMLSpanElement
  }
}
