import type { RenderPolicy } from '@/markdown/renderUntrusted'

/** Node-relative links/embeds cannot read or navigate the vault by coincidentally equal paths. */
export const nodeMarkdownPolicy: RenderPolicy = {
  messageCards: false,
  before: (root) => {
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
