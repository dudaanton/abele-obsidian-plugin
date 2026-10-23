const surfaces = new WeakMap<Document, { close(): void }>()

/** A newer code gesture dismisses the old surface and invalidates its pending response. */
export function beginCodeSurface(document: Document, close: () => void): () => boolean {
  const previous = surfaces.get(document)
  const current = { close }
  surfaces.set(document, current)
  previous?.close()
  return () => surfaces.get(document) === current
}
