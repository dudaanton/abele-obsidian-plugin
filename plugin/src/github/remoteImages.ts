/** GitHub pictures load normally; other sites wait behind a button naming the host. */
import { imageSource, type RepoFile } from './markdownLinks'

function automatic(src: string, repo: RepoFile): boolean {
  if (/^(data:image\/|blob:)/i.test(src)) return true
  try {
    const url = new URL(src)
    if (!['https:', 'http:'].includes(url.protocol)) return false
    const host = url.hostname.toLowerCase()
    return (
      url.host === repo.host ||
      host === 'github.com' ||
      ['githubusercontent.com', 'githubassets.com'].some(
        (h) => host === h || host.endsWith(`.${h}`)
      )
    )
  } catch {
    return false
  }
}

function placeholder(img: Element, src: string, approved: Set<string>): HTMLElement {
  const doc = img.ownerDocument
  const button = doc.win.createEl('button')
  const url = new URL(src)
  const alt = img.getAttribute('alt') || 'Image'
  button.type = 'button'
  button.className = 'abele-remote-image'
  button.textContent = `${alt} · ${url.host}`
  button.setAttribute('aria-label', `Load image from ${url.host}`)
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    approved.add(src)
    const loaded = doc.win.createEl('img')
    loaded.src = src
    loaded.alt = alt
    for (const size of ['width', 'height']) {
      const value = img.getAttribute(size)
      if (value) loaded.setAttribute(size, value)
    }
    button.replaceWith(loaded)
  })
  return button
}

/** Run synchronously before processors can yield, and again after repository link rewriting. */
export function guardGithubImages(root: HTMLElement, repo: RepoFile, approved: Set<string>): void {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const el of elements) {
    const srcset = el.getAttribute('srcset')
    if (srcset) {
      const sources = srcset.split(',').map((entry) => {
        const [raw, ...size] = entry.trim().split(/\s+/)
        const source = imageSource(raw, repo)
        return { source, size }
      })
      const held = sources.find(
        ({ source }) => source && !automatic(source.src, repo) && !approved.has(source.src)
      )?.source
      // A responsive variant must not silently fetch a different site than the fallback.
      el.removeAttribute('srcset')
      if (held) el.parentNode?.insertBefore(placeholder(el, held.src, approved), el)
      else {
        const safe = sources
          .filter(({ source }) => source)
          .map(({ source, size }) => [source!.src, ...size].join(' '))
        if (safe.length) el.setAttribute('srcset', safe.join(', '))
      }
    }
    if (el.localName !== 'img' && el.localName !== 'image') continue
    const attr = el.localName === 'img' ? 'src' : el.hasAttribute('href') ? 'href' : 'xlink:href'
    const raw = el.getAttribute(attr)
    if (!raw) continue
    const source = imageSource(raw, repo)
    el.removeAttribute(attr)
    if (!source) continue
    if (automatic(source.src, repo) || approved.has(source.src)) {
      el.setAttribute(attr, source.src)
      if (source.repoPath) el.setAttribute('data-abele-repo-path', source.repoPath)
    } else {
      const button = placeholder(el, source.src, approved)
      if (el.localName === 'image') {
        const svg = el.closest('svg')
        svg?.parentNode?.insertBefore(button, svg)
        el.remove()
      } else el.replaceWith(button)
    }
  }
}
