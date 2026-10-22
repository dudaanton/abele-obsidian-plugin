import './lspMenu.css'

/** Keep full diagnostic messages readable in Obsidian's otherwise single-line phone menus. */
export function lspMenuLabel(doc: Document, text: string): DocumentFragment {
  const fragment = createFragment()
  fragment.appendChild(doc.win.createSpan({ cls: 'abele-lsp-menu-message', text }))
  return fragment
}

/** The node requests plaintext hover: keep the signature and prose as text, never HTML. */
export function appendLspHoverContent(parent: HTMLElement, text: string): void {
  if (!text) return
  const doc = parent.ownerDocument
  // Plaintext servers separate multi-line signatures from prose with an empty line.
  // A single-line signature may also be followed directly by its documentation.
  const separator = text.indexOf('\n\n')
  const split = separator >= 0 ? separator : text.indexOf('\n')
  const signature = split < 0 ? text : text.slice(0, split)
  const documentation = split < 0 ? '' : text.slice(split).trim()
  const pre = parent.appendChild(doc.win.createEl('pre'))
  pre.className = 'abele-lsp-signature'
  pre.appendChild(doc.win.createEl('code')).textContent = signature
  if (documentation) {
    const prose = parent.appendChild(doc.win.createDiv())
    prose.className = 'abele-lsp-documentation'
    prose.textContent = documentation
  }
}

export function lspHoverMenuLabel(doc: Document, text: string): DocumentFragment {
  const fragment = createFragment()
  const content = fragment.appendChild(doc.win.createDiv())
  content.className = 'abele-lsp-menu-message'
  appendLspHoverContent(content, text)
  return fragment
}
