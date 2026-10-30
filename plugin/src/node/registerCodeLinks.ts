import { Keymap, Platform, type Plugin } from 'obsidian'
import { EditorView } from '@codemirror/view'
import { isNodeCodeLink } from './codeLinks'
import { nodeErrorNotice } from './errorNotice'

/** Resolve both rendered anchors and the styled text Obsidian draws in Markdown editors. */
function codeLinkAt(event: MouseEvent): string | undefined {
  // Avoid instanceof: the element may belong to an Obsidian popout window.
  const element = event.target as Element | null
  const link = element?.closest?.('a, area, [data-node-resource], [data-href]')
  if (link) {
    for (const attr of ['data-node-resource', 'data-href', 'href']) {
      const resource = link.getAttribute(attr)
      if (resource && isNodeCodeLink(resource)) return resource
    }
  }
  const styled = element?.closest?.('.cm-link, .cm-url, .cm-hmd-internal-link')
  const root = styled?.closest('.cm-editor')
  if (!root) return
  const live = !!root.closest('.is-live-preview')
  if (!live && event.button !== 1 && !Keymap.isModEvent(event)) return
  try {
    const view = EditorView.findFromDOM(root as HTMLElement)
    if (!view) return
    const pos = view.posAtDOM(element)
    const line = view.state.doc.lineAt(pos)
    const offset = pos - line.from
    // The encoded JSON can contain literal parentheses in paths. Its closing %7D
    // bounds the destination before the Markdown closing parenthesis.
    const uri = 'abele-node-code:(?:[^\\s]*?%7d|[^\\s)>]*)'
    const patterns = [
      new RegExp(`\\[[^\\]]*\\]\\(\\s*<?(${uri})>?(?:\\s+[^)]*)?\\)`, 'gi'),
      new RegExp(`<?(${uri})>?`, 'gi'),
    ]
    for (const pattern of patterns)
      for (const match of line.text.matchAll(pattern))
        if (offset >= match.index && offset < match.index + match[0].length) return match[1]
  } catch {
    // A view being detached cannot supply an editor destination.
  }
}

/** Capture before native and component handlers; even invalid citations never reach the OS. */
export function registerNodeCodeLinks(plugin: Plugin): void {
  const documents = new WeakSet<Document>()
  const openedOnDown = new WeakSet<EventTarget>()
  const handle = (event: MouseEvent) => {
    if (event.button !== 0 && event.button !== 1) return
    const resource = codeLinkAt(event)
    if (!resource) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === 'mousedown') {
      if (!Platform.isAndroidApp) return
      if (event.target) openedOnDown.add(event.target)
    } else if (event.target && openedOnDown.delete(event.target)) return
    void import('./openNodeCodeLink')
      .then(({ openNodeCodeLink }) => openNodeCodeLink(resource))
      .catch((error) => nodeErrorNotice(error))
  }
  const listen = (doc: Document) => {
    if (documents.has(doc)) return
    documents.add(doc)
    for (const type of ['mousedown', 'click', 'auxclick'] as const)
      plugin.registerDomEvent(doc, type, handle, { capture: true })
  }
  listen(document)
  plugin.app.workspace.iterateAllLeaves((leaf) => listen(leaf.view.containerEl.ownerDocument))
  plugin.registerEvent(
    plugin.app.workspace.on('window-open', (_workspace, win) => listen(win.document))
  )
}
