/** Local note/heading links remain local; external links can only open web or mail. */
export function guardExternalLinks(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll('a,area'))) {
    const internal = el.classList.contains('internal-link')
    for (const attr of Array.from(el.attributes)) {
      if (attr.localName !== 'href' && attr.name !== 'data-href') continue
      const value = attr.value.trim()
      let allowed = value.startsWith('#') || value.startsWith('//')
      try {
        allowed ||= ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol)
      } catch {
        /* A note path is not an absolute URL. */
      }
      if (
        internal &&
        !/^[a-z][a-z0-9+.-]*:|^[\\/]{2}/i.test(
          Array.from(value)
            .filter((c) => c.charCodeAt(0) > 32)
            .join('')
        )
      )
        allowed = true
      if (!allowed) {
        el.removeAttributeNode(attr)
        el.setAttribute('data-abele-blocked', '')
      }
    }
    if (el.hasAttribute('data-abele-blocked')) {
      el.removeAttribute('href')
      el.removeAttribute('data-href')
      el.classList.remove('internal-link', 'external-link')
    }
  }
}
