import css from 'maplibre-gl/dist/maplibre-gl.css?inline'

const documents = new WeakMap<Document, { style: HTMLStyleElement; users: number }>()

/** MapLibre's rules belong only to windows with maps, not the global plugin stylesheet. */
export function acquireMapStyles(doc: Document): () => void {
  let entry = documents.get(doc)
  if (!entry) {
    const style = doc.win.createEl('style')
    style.dataset.abeleMap = ''
    style.textContent = css
    doc.head.appendChild(style)
    entry = { style, users: 0 }
    documents.set(doc, entry)
  }
  entry.users++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--entry.users === 0) {
      entry.style.remove()
      documents.delete(doc)
    }
  }
}
