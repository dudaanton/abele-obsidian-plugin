/** Offline frames cannot execute scripts: CSP does not block a script navigating its own frame.
 * Rebuild a small static HTML vocabulary in an inert template, eliminating declarative navigation
 * (refresh, anchors, forms, SVG animation, nested documents) before a browsing context exists.
 * Network-bearing CSS and media are additionally blocked by the frame's CSP. */
export function staticHtml(source: string, doc: Document): string {
  const parsed = doc.createElement('template')
  // This template stays inert and is never mounted; only the rebuilt whitelist reaches a frame.
  // eslint-disable-next-line no-unsanitized/property -- Inert parsing only; the whitelist below builds the actual rendered document.
  parsed.innerHTML = source
  const output = doc.createElement('template')
  const tags = new Set(
    'div span p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd blockquote pre code strong em b i u s small sub sup br hr table thead tbody tfoot tr th td caption colgroup col details summary img audio video source style'.split(
      ' '
    )
  )
  const attributes = new Set(
    'class id title alt style width height colspan rowspan scope open controls loop muted playsinline type'.split(
      ' '
    )
  )
  const copy = (node: Node, parent: Node) => {
    if (node.nodeType === 3) {
      parent.appendChild(doc.createTextNode(node.textContent ?? ''))
      return
    }
    if (node.nodeType !== 1) return
    const element = node as Element
    const tag = element.localName.toLowerCase()
    // Links keep their text but no ability to navigate; active/foreign vocabularies are discarded.
    if (tag === 'a' || tag === 'html' || tag === 'head' || tag === 'body') {
      for (const child of Array.from(element.childNodes)) copy(child, parent)
      return
    }
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !tags.has(tag)) return
    const clean = doc.createElement(tag)
    for (const attribute of Array.from(element.attributes)) {
      if (attributes.has(attribute.name)) clean.setAttribute(attribute.name, attribute.value)
      else if (
        attribute.name === 'src' &&
        ['img', 'audio', 'video', 'source'].includes(tag) &&
        /^data:(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+);base64,[a-z\d+/=\s]+$/i.test(
          attribute.value
        )
      )
        clean.setAttribute('src', attribute.value)
    }
    if (tag === 'style') clean.textContent = element.textContent
    else for (const child of Array.from(element.childNodes)) copy(child, clean)
    parent.appendChild(clean)
  }
  for (const node of Array.from(parsed.content.childNodes)) copy(node, output.content)
  return output.innerHTML
}
