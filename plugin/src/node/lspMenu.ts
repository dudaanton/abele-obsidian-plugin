import './lspMenu.css'

/** Keep full diagnostic messages readable in Obsidian's otherwise single-line phone menus. */
export function lspMenuLabel(doc: Document, text: string): DocumentFragment {
  const fragment = createFragment()
  fragment.appendChild(doc.win.createSpan({ cls: 'abele-lsp-menu-message', text }))
  return fragment
}
