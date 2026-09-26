/**
 * Every document a note can be drawn in: the main window's, and one per popout window.
 *
 * A widget's mount element lives in the document of the window its note is open in, so a
 * lookup in the global `document` alone misses every note opened in a popout. The documents
 * are read off the open leaves each time — a popout window comes and goes with its leaves.
 */
import { GlobalStore } from '@/stores/GlobalStore'

export function openDocuments(): Document[] {
  const docs = new Set<Document>([document])
  const workspace = GlobalStore.getInstance().app?.workspace
  workspace?.iterateAllLeaves?.((leaf) => {
    const doc = leaf.view?.containerEl?.ownerDocument
    if (doc) docs.add(doc)
  })
  return Array.from(docs)
}

/** The first element matching `selector` in any open window, or null. */
export function findInAnyWindow(selector: string): HTMLElement | null {
  for (const doc of openDocuments()) {
    const el = doc.querySelector<HTMLElement>(selector)
    if (el) return el
  }
  return null
}
