import type { EditorView } from '@codemirror/view'

/** Standalone so the same function can be evaluated inside the app window. */
export async function withCodeGuideSettings<T>(
  vault: {
    getConfig(key: string): unknown
    setConfig(key: string, value: unknown): void
    requestSaveConfig?: { run(): unknown }
  },
  probe: () => Promise<T>
): Promise<T> {
  const enabled = vault.getConfig('showIndentGuide')
  const tabSize = vault.getConfig('tabSize')
  try {
    vault.setConfig('showIndentGuide', true)
    vault.setConfig('tabSize', 4)
    await vault.requestSaveConfig?.run()
    return await probe()
  } finally {
    vault.setConfig('showIndentGuide', enabled)
    vault.setConfig('tabSize', tabSize)
    await vault.requestSaveConfig?.run()
  }
}

/** Native clicks must hit editor text, rather than a mobile toolbar over the scroller. */
export function codeGuideClickTarget(view: EditorView, from: number) {
  const doc = view.dom.ownerDocument
  const first = view.coordsAtPos(from + 4)
  if (!first) return null
  const viewport = view.scrollDOM.getBoundingClientRect()
  for (let pos = from + 4; pos < view.state.doc.lineAt(from).to; pos += 9) {
    const box = view.coordsAtPos(pos)
    if (!box || box.top <= first.top + 2) continue
    if (
      box.top < Math.max(0, viewport.top) ||
      box.bottom > Math.min(doc.defaultView.innerHeight, viewport.bottom)
    )
      continue
    const x = Math.round(box.left),
      y = Math.round((box.top + box.bottom) / 2)
    const hit = doc.elementFromPoint(x, y)
    if (hit && view.contentDOM.contains(hit)) return { pos, x, y }
  }
  return null
}
