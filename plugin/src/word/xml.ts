/** Lexical XML tree: offsets refer to the original string, so unchanged XML is never serialized. */
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
export interface XmlNode {
  name: string
  local: string
  ns: string
  attrs: Record<string, string>
  namespaces: Record<string, string>
  start: number
  openEnd: number
  closeStart: number
  end: number
  children: XmlNode[]
  parent?: XmlNode
}
export const escapeXml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
/** Change an existing whitespace attribute regardless of spacing/quoting; never append a duplicate. */
export function preserveXmlSpace(open: string): string {
  const attribute = /(\s+xml:space\s*=\s*)(?:"[^"]*"|'[^']*')/
  if (attribute.test(open))
    return open.replace(attribute, (_, prefix: string) => `${prefix}"preserve"`)
  return open.replace(/(\s*\/?>)$/, (_, close: string) => ` xml:space="preserve"${close}`)
}

export function decodeXml(text: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#(?:x[0-9a-f]+|[0-9]+));)/i.test(text))
    throw new Error('Invalid XML entities')
  return text.replace(/&([^;]+);/g, (_all, entity: string) => {
    const predefined: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (entity in predefined) return predefined[entity]
    if (/^#(?:x[0-9a-f]+|[0-9]+)$/i.test(entity)) {
      const n =
        entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      if (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)) return String.fromCodePoint(n)
    }
    throw new Error('Unsupported XML entities')
  })
}
export function decodeXmlContent(source: string): string {
  const tokens = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g
  let at = 0
  let text = ''
  let match: RegExpExecArray | null
  while ((match = tokens.exec(source))) {
    text += decodeXml(source.slice(at, match.index)) + (match[1] ?? '')
    at = tokens.lastIndex
  }
  return text + decodeXml(source.slice(at))
}

export async function parseXml(
  source: string,
  yieldTask: () => Promise<void> = () => Promise.resolve()
): Promise<XmlNode> {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('DOCTYPE and entities are not supported')
  const stack: XmlNode[] = []
  let root: XmlNode | undefined
  const tokens =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_](?:[^<>'"]|"[^"]*"|'[^']*')*>/g
  let m: RegExpExecArray | null
  let previous = 0
  let count = 0
  while ((m = tokens.exec(source))) {
    const between = source.slice(previous, m.index)
    if (between.includes('<') || (!stack.length && between.trim())) throw new Error('Malformed XML')
    decodeXml(between)
    previous = tokens.lastIndex
    const raw = m[0]
    if (raw.startsWith('<?') || raw.startsWith('<!')) continue
    if (raw.startsWith('</')) {
      const node = stack.pop()
      if (!node || /^<\/([^\s>]+)\s*>$/.exec(raw)?.[1] !== node.name)
        throw new Error('Malformed XML closing tag')
      node.closeStart = m.index
      node.end = tokens.lastIndex
    } else {
      const name = /^<([^\s/>]+)/.exec(raw)![1]
      const attrs: Record<string, string> = {}
      const attrSource = raw.slice(name.length + 1).replace(/\/?\s*>$/, '')
      const attrRe = /([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g
      let a: RegExpExecArray | null
      let at = 0
      while ((a = attrRe.exec(attrSource))) {
        if (attrSource.slice(at, a.index).trim() || a[1] in attrs)
          throw new Error('Malformed XML attributes')
        attrs[a[1]] = decodeXml(a[2].slice(1, -1))
        at = attrRe.lastIndex
      }
      if (attrSource.slice(at).trim()) throw new Error('Malformed XML attributes')
      const parent = stack.at(-1)
      const namespaces: Record<string, string> = {
        ...(parent?.namespaces ?? {}),
        xml: 'http://www.w3.org/XML/1998/namespace',
      }
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'xmlns') namespaces[''] = v
        else if (k.startsWith('xmlns:')) namespaces[k.slice(6)] = v
      }
      const [prefix, local] = name.includes(':') ? name.split(':') : ['', name]
      if (prefix && !namespaces[prefix]) throw new Error('Undefined XML namespace')
      const self = /\/\s*>$/.test(raw)
      const node: XmlNode = {
        name,
        local,
        ns: namespaces[prefix] ?? '',
        attrs,
        namespaces,
        start: m.index,
        openEnd: tokens.lastIndex,
        closeStart: tokens.lastIndex,
        end: tokens.lastIndex,
        children: [],
        parent,
      }
      if (parent) parent.children.push(node)
      else if (root) throw new Error('Multiple XML roots')
      else root = node
      if (!self) stack.push(node)
    }
    // Yield to input/paint while indexing large documents; no DOM construction is needed.
    if (++count % 4000 === 0) {
      // The client supplies a task yield; the byte model also works without a browser.
      await yieldTask()
    }
  }
  if (stack.length || !root || source.slice(previous).trim()) throw new Error('Malformed XML')
  return root
}
export const isW = (n: XmlNode, local: string) => n.ns === W && n.local === local
export const child = (n: XmlNode, local: string) => n.children.find((c) => isW(c, local))
export function descendants(n: XmlNode, ns = W, local?: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (node: XmlNode) => {
    if (node.ns === ns && (!local || node.local === local)) out.push(node)
    for (const c of node.children) walk(c)
  }
  walk(n)
  return out
}
export function attr(n: XmlNode | undefined, local: string, ns = W): string | undefined {
  if (!n) return undefined
  return Object.entries(n.attrs).find(([key]) => {
    const [prefix, name] = key.includes(':') ? key.split(':') : ['', key]
    return name === local && (prefix ? n.namespaces[prefix] : '') === ns
  })?.[1]
}
export function ancestor(n: XmlNode, local: string): XmlNode | undefined {
  for (let p = n.parent; p; p = p.parent) if (isW(p, local)) return p
}
export const rawNode = (source: string, node: XmlNode) => source.slice(node.start, node.end)

/** Preserve inherited bindings when moving a fragment out of its original container. */
export function carryNamespaces(
  fragment: string,
  node: XmlNode,
  destination: Record<string, string>
): string {
  const declarations = Object.entries({ '': '', ...node.namespaces })
    .filter(
      ([prefix, uri]) =>
        prefix !== 'xml' &&
        uri !== (destination[prefix] ?? (prefix === '' ? '' : undefined)) &&
        node.attrs[prefix ? `xmlns:${prefix}` : 'xmlns'] === undefined
    )
    .map(([prefix, uri]) => ` ${prefix ? `xmlns:${prefix}` : 'xmlns'}="${escapeXml(uri)}"`)
    .join('')
  if (!declarations) return fragment
  const length = node.openEnd - node.start
  const open = fragment.slice(0, length).replace(/(\/?>)$/, (_, end: string) => declarations + end)
  return open + fragment.slice(length)
}
export function carryContents(
  source: string,
  node: XmlNode,
  destination: Record<string, string>
): string {
  const content = source.slice(node.openEnd, node.closeStart)
  return patchXml(
    content,
    node.children.map((child) => ({
      start: child.start - node.openEnd,
      end: child.end - node.openEnd,
      text: carryNamespaces(rawNode(source, child), child, destination),
    }))
  )
}
export function sameNamespaces(a: Record<string, string>, b: Record<string, string>): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b), ''])].every(
    (prefix) =>
      (a[prefix] ?? (prefix === '' ? '' : undefined)) ===
      (b[prefix] ?? (prefix === '' ? '' : undefined))
  )
}
export interface Patch {
  start: number
  end: number
  text: string
}
export function patchXml(source: string, patches: Patch[]): string {
  const sorted = patches.slice().sort((a, b) => b.start - a.start || b.end - a.end)
  let before = source.length
  for (const p of sorted) {
    if (p.start < 0 || p.end < p.start || p.end > before) throw new Error('Overlapping XML edits')
    source = source.slice(0, p.start) + p.text + source.slice(p.end)
    before = p.start
  }
  return source
}
