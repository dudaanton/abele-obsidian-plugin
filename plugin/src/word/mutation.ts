import { strFromU8 } from 'fflate'
import { saveParts, xmlBytes, xmlPart, type WordPackage } from './package'
import { escapeXml, parseXml, patchXml, rawNode, REL, type XmlNode } from './xml'
import { isEmptyNode, nodeWithContent } from './structure'

export const CONTENT = 'http://schemas.openxmlformats.org/package/2006/content-types'
export class WordMutation {
  readonly parts = new Map<string, Uint8Array | null>()
  constructor(readonly doc: WordPackage) {}
  source(name: string, fallback?: string): string {
    const changed = this.parts.get(name)
    const source = changed
      ? strFromU8(changed)
      : (this.doc.xml.get(name) ?? xmlPart(this.doc.archive, name) ?? fallback)
    if (source === undefined || source === null) throw new Error(`Missing XML part ${name}`)
    return source
  }
  set(name: string, source: string) {
    this.parts.set(name, xmlBytes(source))
  }
  async append(name: string, fragment: string, fallback?: string): Promise<void> {
    const source = this.source(name, fallback)
    const root = await parseXml(source)
    this.set(
      name,
      isEmptyNode(source, root)
        ? nodeWithContent(source, root, fragment)
        : patchXml(source, [{ start: root.closeStart, end: root.closeStart, text: fragment }])
    )
  }
  async relation(target: string, type: string, external = false): Promise<string> {
    const name = 'word/_rels/document.xml.rels'
    const fallback = `<Relationships xmlns="${REL}"></Relationships>`
    const source = this.source(name, fallback)
    const root = await parseXml(source)
    const ids = new Set(root.children.map((n) => n.attrs.Id))
    let i = 1
    while (ids.has(`abeleRel${i}`)) i++
    const id = `abeleRel${i}`
    await this.append(
      name,
      `<Relationship xmlns="${REL}" Id="${id}" Type="${escapeXml(type)}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`,
      fallback
    )
    return id
  }
  async ensureType(part: string, mime: string): Promise<void> {
    const name = '[Content_Types].xml'
    const source = this.source(name)
    const root = await parseXml(source)
    if (root.children.some((n) => n.attrs.PartName === `/${part}`)) return
    await this.append(
      name,
      `<Override xmlns="${CONTENT}" PartName="/${escapeXml(part)}" ContentType="${escapeXml(mime)}"/>`
    )
  }
  async finish(): Promise<Uint8Array> {
    for (const [name, bytes] of this.parts) {
      const before = this.doc.archive.loadBytes(name)
      if (
        bytes &&
        before &&
        bytes.length === before.length &&
        bytes.every((b, i) => b === before[i])
      )
        this.parts.delete(name)
    }
    return saveParts(this.doc, this.parts)
  }
}
export function setAttribute(source: string, node: XmlNode, name: string, value: string): string {
  const raw = rawNode(source, node)
  const open = source.slice(node.start, node.openEnd)
  const regex = new RegExp(
    `(\\s${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*)(?:"[^"]*"|'[^']*')`
  )
  const next = regex.test(open)
    ? open.replace(regex, (_, prefix: string) => `${prefix}"${escapeXml(value)}"`)
    : open.replace(/(\/?>)$/, ' ' + name + '="' + escapeXml(value) + '"$1')
  return next + raw.slice(open.length)
}
