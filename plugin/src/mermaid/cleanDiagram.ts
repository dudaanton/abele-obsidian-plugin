/** Defence in depth after Mermaid's strict mode, while the drawing is still detached. */
export function cleanDiagram(svg: Element): void {
  // Obsidian exposes its DOMPurify instance. Keep Mermaid's HTML labels inside foreignObject.
  const purifier = (
    window as unknown as {
      DOMPurify?: { sanitize(node: Element, options: Record<string, unknown>): unknown }
    }
  ).DOMPurify
  purifier?.sanitize(svg, {
    IN_PLACE: true,
    ADD_TAGS: ['foreignObject'],
    FORBID_TAGS: ['iframe', 'form'],
  })
  const removed = new Set([
    'script',
    'iframe',
    'frame',
    'object',
    'embed',
    'link',
    'meta',
    'base',
    'portal',
    'noscript',
    'form',
    'input',
    'button',
    'animate',
    'animatetransform',
    'animatemotion',
    'set',
  ])
  for (const el of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    if (removed.has(el.localName.toLowerCase())) {
      el.remove()
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      const value = attr.value.trim()
      const squashed = Array.from(value)
        .filter((c) => c.charCodeAt(0) > 32)
        .join('')
      if (
        attr.name.toLowerCase().startsWith('on') ||
        /^(?:javascript:|vbscript:|data:text)/i.test(squashed)
      ) {
        el.removeAttributeNode(attr)
      } else if (attr.localName === 'href' && el.localName === 'a') {
        const internal =
          el.classList.contains('internal-link') && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)
        if (!internal && !/^(https?:|mailto:|#)/i.test(value)) el.removeAttributeNode(attr)
      }
    }
  }
}
