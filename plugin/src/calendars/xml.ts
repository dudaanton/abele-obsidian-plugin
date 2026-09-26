/**
 * Just enough XML to read a WebDAV answer: elements by namespace and local name, and their
 * text.
 *
 * CalDAV servers pick their own prefixes (`d:`, `D:`, none at all with a default namespace),
 * so matching has to go by namespace, not by the name as written. `DOMParser` would do it in
 * Obsidian, but not in the test environment, and a server's answer is small and regular enough
 * that a reader of its own costs less than the difference.
 */

export interface XmlElement {
  ns: string
  name: string
  /** Attributes by the name as written, namespace declarations included. */
  attrs: Record<string, string>
  children: XmlElement[]
  /** The element's own text and its children's, entities decoded. */
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

interface Open {
  element: XmlElement
  scope: Map<string, string>
  parts: string[]
}

const ATTR = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g

/** @throws when the text is not XML this reader can follow */
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { ns: '', name: '#document', attrs: {}, children: [], text: '' }
  const stack: Open[] = [
    { element: root, scope: new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]), parts: [] },
  ]
  const tag =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)([^>]*?)(\/?)>/g
  let at = 0
  let m: RegExpExecArray | null
  const top = () => stack[stack.length - 1]

  while ((m = tag.exec(xml))) {
    if (m.index > at) top().parts.push(decode(xml.slice(at, m.index)))
    at = tag.lastIndex
    if (m[1] !== undefined) {
      top().parts.push(m[1])
      continue
    }
    if (!m[3]) continue // comment, declaration, doctype

    const [, , closing, qname, attrs, selfClosing] = m
    if (closing) {
      const open = stack.pop()
      if (!open || stack.length === 0) throw new Error(`Unexpected </${qname}> in the answer.`)
      open.element.text = open.parts.join('')
      top().parts.push(open.element.text)
      continue
    }

    const scope = new Map(top().scope)
    const attributes: Record<string, string> = {}
    for (const a of attrs.matchAll(ATTR)) {
      const value = decode(a[3] ?? a[4] ?? '')
      attributes[a[1]] = value
      if (a[1] === 'xmlns') scope.set('', value)
      else if (a[1].startsWith('xmlns:')) scope.set(a[1].slice(6), value)
    }
    const colon = qname.indexOf(':')
    const prefix = colon === -1 ? '' : qname.slice(0, colon)
    const element: XmlElement = {
      ns: scope.get(prefix) ?? '',
      name: colon === -1 ? qname : qname.slice(colon + 1),
      attrs: attributes,
      children: [],
      text: '',
    }
    top().element.children.push(element)
    if (!selfClosing) stack.push({ element, scope, parts: [] })
  }
  if (stack.length !== 1) throw new Error('The answer ended in the middle of an element.')
  if (!root.children.length) throw new Error('The answer holds no XML.')
  return root
}

/** Every element below this one, at any depth, with this namespace and name. */
export function findAll(element: XmlElement, ns: string, name: string): XmlElement[] {
  const found: XmlElement[] = []
  const walk = (e: XmlElement) => {
    for (const child of e.children) {
      if (child.ns === ns && child.name === name) found.push(child)
      walk(child)
    }
  }
  walk(element)
  return found
}

export const findFirst = (element: XmlElement, ns: string, name: string): XmlElement | null =>
  findAll(element, ns, name)[0] ?? null

/** Direct children only. */
export const childrenOf = (element: XmlElement, ns: string, name: string): XmlElement[] =>
  element.children.filter((c) => c.ns === ns && c.name === name)
