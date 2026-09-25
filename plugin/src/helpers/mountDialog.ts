import { createApp, type Component } from 'vue'

/**
 * Mounts a dialog component on its own, from code that is not itself a component — a command,
 * a card in a list. The component renders the kit's `Modal`, which teleports into Obsidian's
 * own dialog; the host here only keeps the Vue app alive. The component's `close` event takes
 * both down again.
 */
export function mountDialog(
  component: Component,
  props: Record<string, unknown> = {},
  doc: Document = activeDocument
): () => void {
  const host = doc.body.appendChild(doc.win.createDiv())
  let open = true
  const close = () => {
    if (!open) return
    open = false
    app.unmount()
    host.remove()
  }
  const app = createApp(component, { ...props, onClose: close })
  app.mount(host)
  return close
}
