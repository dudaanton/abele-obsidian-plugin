import { Platform } from 'obsidian'

// Contextmenu events often have no click count. Only an event without pointer coordinates
// falls back to the focused control; a bubbled event's currentTarget may be the whole file.
export const nodePathMenuPosition = (event: MouseEvent) => {
  const el = event.currentTarget ?? event.target
  const pointer = event as MouseEvent & {
    pointerType?: string
    sourceCapabilities?: { firesTouchEvents?: boolean }
  }
  const touch =
    pointer.pointerType === 'touch' ||
    pointer.sourceCapabilities?.firesTouchEvents ||
    (!pointer.pointerType && Platform.isMobile)
  if (touch && event.target instanceof Element) {
    const line = event.target.closest('.cm-line, .cm-gutterElement, .abele-diff__line')
    if (line) return { x: event.clientX, y: line.getBoundingClientRect().bottom }
  }
  if (event.detail === 0 && event.clientX === 0 && event.clientY === 0 && el instanceof Element) {
    const rect = el.getBoundingClientRect()
    return { x: rect.left, y: rect.bottom }
  }
  // Obsidian's Menu.showAtPosition keeps the menu within the viewport.
  return { x: event.clientX, y: event.clientY }
}
