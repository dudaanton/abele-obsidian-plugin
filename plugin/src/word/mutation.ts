import type { WordPackage } from './package'
import { escapeXml, parseXml, REL } from './xml'
import { PackageMutation } from '@/ooxml/mutation'
export { CONTENT, setAttribute } from '@/ooxml/mutation'

export class WordMutation extends PackageMutation {
  constructor(readonly doc: WordPackage) {
    super(doc)
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
}
