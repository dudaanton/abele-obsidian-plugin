import type { RenderPolicy } from '@/markdown/renderUntrusted'

/** Node-relative links/embeds cannot read or navigate the vault by coincidentally equal paths. */
export const nodeMarkdownPolicy: RenderPolicy = {
  messageCards: false,
  before: (root) => {
    prepareNodeCodeLinks(root)
    for (const embed of Array.from(root.querySelectorAll('.internal-embed'))) {
      const path =
        embed.getAttribute('src') ?? embed.getAttribute('data-href') ?? embed.textContent ?? ''
      const link = root.createEl('a')
      link.textContent = path
      link.setAttribute('data-node-resource', path)
      link.setAttribute('href', '#')
      embed.replaceWith(link)
    }
    for (const image of Array.from(root.querySelectorAll('img'))) {
      const src = image.getAttribute('src') ?? ''
      if (!/^https?:\/\//i.test(src))
        image.replaceWith(root.ownerDocument.createTextNode(image.getAttribute('alt') || src))
    }
  },
}

export function nodeMarkdownClick(event: MouseEvent, open: (path: string) => void): boolean {
  const link = (event.target as Element | null)?.closest?.('a')
  if (!link) return false
  const path =
    link.getAttribute('data-node-resource') ??
    link.getAttribute('data-href') ??
    link.getAttribute('href') ??
    ''
  if (/^https?:\/\//i.test(path) || /^mailto:/i.test(path)) return false
  event.preventDefault()
  event.stopPropagation()
  open(path)
  return true
}

export function prepareNodeCodeLinks(root: HTMLElement, citationsOnly = false): void {
  // Preserve node citations before the common URL guard strips non-web protocols.
  for (const link of Array.from(root.querySelectorAll('a'))) {
    const path =
      link.getAttribute('data-node-resource') ??
      link.getAttribute('data-href') ??
      link.getAttribute('href') ??
      ''
    const citation = /(?:\.[\w-]+:\d+(?:-\d+)?|#L\d+(?:-L\d+)?)$/.test(path)
    if (
      /^(?:abele-node-code:|file:\/\/\/)/.test(path) ||
      (!/^(?:https?|mailto):|^\/\//i.test(path) &&
        (citation || (!citationsOnly && !/^[a-z][a-z0-9+.-]*:/i.test(path))))
    ) {
      link.setAttribute('data-node-resource', path)
      link.setAttribute('href', '#')
      link.removeAttribute('data-href')
    }
  }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) {
    const text = walker.currentNode as Text
    if (!text.parentElement?.closest('a, pre, script, style, textarea')) texts.push(text)
  }
  for (const text of texts) {
    const pattern =
      /abele-node-code:%7B[\w%!'()*~.-]*%7D|(?:file:\/\/\/|\/|\.?\.?\/)?[\w.-]+(?:\/[\w.-]+)*\.[\w-]+(?::[1-9]\d*(?:-[1-9]\d*)?|#L[1-9]\d*(?:-L[1-9]\d*)?)/g
    const fragment = createFragment()
    let end = 0
    for (const match of (text.textContent ?? '').matchAll(pattern)) {
      const index = match.index
      if (index && /[\w/:]/.test(text.textContent![index - 1])) continue
      fragment.append(text.textContent!.slice(end, index))
      const link = root.ownerDocument.win.createEl('a')
      link.textContent = match[0]
      link.setAttribute('href', '#')
      link.setAttribute('data-node-resource', match[0])
      fragment.append(link)
      end = index + match[0].length
    }
    if (end) {
      fragment.append(text.textContent!.slice(end))
      text.replaceWith(fragment)
    }
  }
}
