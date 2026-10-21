/** A dialog can belong to Obsidian's separate settings document. */
export function syncModalClosed(box: HTMLElement): boolean {
  return !box.isConnected
}
