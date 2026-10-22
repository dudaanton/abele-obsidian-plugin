import './lspMenu.css'
import { parser } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { languageOf } from '@/github/languages'

const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'abele-lsp-keyword' },
  { tag: tags.string, class: 'abele-lsp-string' },
  { tag: tags.number, class: 'abele-lsp-number' },
  { tag: tags.comment, class: 'abele-lsp-comment' },
  { tag: tags.typeName, class: 'abele-lsp-type' },
  { tag: tags.function(tags.variableName), class: 'abele-lsp-function' },
])

function appendCode(parent: HTMLElement, text: string, language: string) {
  const doc = parent.ownerDocument
  const pre = parent.appendChild(doc.win.createEl('pre'))
  pre.className = 'abele-lsp-signature'
  const code = pre.appendChild(doc.win.createEl('code'))
  const aliases: Record<string, string> = { typescript: 'ts', javascript: 'js' }
  const syntax = languageOf('sample.' + (aliases[language] ?? language))
  let offset = 0
  if (syntax)
    highlightTree(syntax.parser.parse(text), highlighter, (from, to, cls) => {
      code.appendChild(doc.createTextNode(text.slice(offset, from)))
      const span = code.appendChild(doc.win.createSpan())
      span.className = cls
      span.textContent = text.slice(from, to)
      offset = to
    })
  code.appendChild(doc.createTextNode(text.slice(offset)))
}

/** Render only known markdown nodes; server HTML is always inert text. */
function appendMarkdown(parent: HTMLElement, text: string) {
  const doc = parent.ownerDocument
  const render = (node: SyntaxNode, target: HTMLElement) => {
    if (node.name === 'FencedCode') {
      const info = node.getChild('CodeInfo')
      const code = node.getChild('CodeText')
      appendCode(
        target,
        code ? text.slice(code.from, code.to) : '',
        info ? text.slice(info.from, info.to).trim().split(/\s/)[0] : ''
      )
      return
    }
    if (node.name === 'InlineCode') {
      const code = target.appendChild(doc.win.createEl('code'))
      code.textContent = text.slice(node.from, node.to).replace(/^`+|`+$/g, '')
      return
    }
    if (node.name === 'Link') {
      const url = node.getChild('URL')
      const href = url ? text.slice(url.from, url.to) : ''
      const anchor = doc.win.createEl('a')
      if (/^(https?:|mailto:)/i.test(href)) {
        anchor.href = href
        anchor.rel = 'noopener noreferrer'
        anchor.target = '_blank'
      }
      target.appendChild(anchor)
      let offset = node.firstChild?.to ?? node.from
      for (let child = node.firstChild?.nextSibling; child; child = child.nextSibling) {
        if (child.from > offset)
          anchor.appendChild(doc.createTextNode(text.slice(offset, child.from)))
        if (child.name === 'LinkMark') break
        render(child, anchor)
        offset = child.to
      }
      return
    }
    const tag: Record<string, keyof HTMLElementTagNameMap> = {
      Paragraph: 'p',
      BulletList: 'ul',
      OrderedList: 'ol',
      ListItem: 'li',
      Emphasis: 'em',
      StrongEmphasis: 'strong',
      Blockquote: 'blockquote',
      ATXHeading1: 'strong',
      ATXHeading2: 'strong',
      ATXHeading3: 'strong',
      HorizontalRule: 'hr',
      HardBreak: 'br',
    }
    if (/^(EmphasisMark|ListMark|QuoteMark|HeaderMark)$/.test(node.name)) return
    const element = tag[node.name] ? target.appendChild(doc.win.createEl(tag[node.name])) : target
    if (node.name === 'HorizontalRule' || node.name === 'HardBreak') return
    if (!node.firstChild) {
      element.appendChild(doc.createTextNode(text.slice(node.from, node.to)))
      return
    }
    let offset = node.from
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.from > offset)
        element.appendChild(doc.createTextNode(text.slice(offset, child.from)))
      render(child, element)
      offset = child.to
    }
    if (offset < node.to) element.appendChild(doc.createTextNode(text.slice(offset, node.to)))
  }
  const tree = parser.parse(text)
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) render(node, parent)
}

/** Keep full diagnostic messages readable in Obsidian's otherwise single-line phone menus. */
export function lspMenuLabel(doc: Document, text: string): DocumentFragment {
  const fragment = createFragment()
  fragment.appendChild(doc.win.createSpan({ cls: 'abele-lsp-menu-message', text }))
  return fragment
}

/** Accept markdown responses as well as older plaintext language servers. */
export function appendLspHoverContent(parent: HTMLElement, text: string): void {
  if (!text) return
  const doc = parent.ownerDocument
  if (/^\s*(```|~~~)/.test(text)) {
    const tree = parser.parse(text)
    const first = tree.topNode.firstChild
    if (first?.name === 'FencedCode') {
      appendMarkdown(parent, text.slice(first.from, first.to))
      const rest = text.slice(first.to).trim()
      if (rest) {
        parent.appendChild(doc.win.createEl('hr'))
        const prose = parent.appendChild(doc.win.createDiv())
        prose.className = 'abele-lsp-documentation'
        appendMarkdown(prose, rest)
      }
      return
    }
  }
  // Plaintext servers separate multi-line signatures from prose with an empty line.
  const separator = text.indexOf('\n\n')
  const split = separator >= 0 ? separator : text.indexOf('\n')
  appendCode(parent, split < 0 ? text : text.slice(0, split), '')
  if (split >= 0) {
    const prose = parent.appendChild(doc.win.createDiv())
    prose.className = 'abele-lsp-documentation'
    appendMarkdown(prose, text.slice(split).trim())
  }
}

export function lspHoverMenuLabel(doc: Document, text: string): DocumentFragment {
  const fragment = createFragment()
  const content = fragment.appendChild(doc.win.createDiv())
  content.className = 'abele-lsp-menu-message'
  appendLspHoverContent(content, text)
  return fragment
}
