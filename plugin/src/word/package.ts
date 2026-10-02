/** OOXML package model over bytes, with no vault or Obsidian dependency. */
import type { ZipLoader } from '@/reader/zipLoader'
import { foldedWordText } from './search'
import { openOfficeArchive, xmlPart } from '@/ooxml/package'
export { MAX_XML, MAX_ARCHIVE, MAX_EXPANDED, pack, saveParts, xmlBytes, xmlPart } from '@/ooxml/package'
import {
  ancestor,
  attr,
  child,
  decodeXmlContent,
  descendants,
  isW,
  parseXml,
  R,
  REL,
  W,
  type XmlNode,
} from './xml'

export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
export const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
export interface WordImage {
  number: number
  paragraph: number
  node: XmlNode
  drawing: XmlNode
  inline: boolean
  relId: string
  width: number
  height: number
  protected: boolean
}

export interface TextRun {
  node: XmlNode
  run?: XmlNode
  text: string
  offset: number
  protected: boolean
}
export interface WordParagraph {
  number: number
  part: string
  node: XmlNode
  text: string
  runs: TextRun[]
  style?: string
  table?: number
  row?: number
  cell?: number
  editable: boolean
  protected: boolean
}
export interface WordTable {
  number: number
  node: XmlNode
  rows: XmlNode[]
}
export interface WordStyle {
  id: string
  name: string
  heading: boolean
}
export interface WordPackage {
  original: Uint8Array
  archive: ZipLoader
  xml: Map<string, string>
  trees: Map<string, XmlNode>
  paragraphs: WordParagraph[]
  tables: WordTable[]
  styles: WordStyle[]
  images: WordImage[]
  links: { paragraph: number; from: number; to: number; url: string }[]
  richPreview: boolean
  read(start: number, count: number, max: number): string
  search(
    query: string,
    after: number,
    limit: number
  ): {
    total: number
    finds: { paragraph: number; offset: number; length: number; excerpt: string }[]
  }
}
export async function openDocx(
  original: Uint8Array,
  yieldTask?: () => Promise<void>
): Promise<WordPackage> {
  const archive = await openOfficeArchive(original, yieldTask)
  const xml = new Map<string, string>()
  const trees = new Map<string, XmlNode>()
  const names = [
    'word/document.xml',
    'word/styles.xml',
    'word/_rels/document.xml.rels',
    ...archive.entries
      .filter((e) =>
        /^word\/(?:header\d+|footer\d+|comments|footnotes|endnotes)\.xml$/.test(e.filename)
      )
      .map((e) => e.filename),
  ]
  for (const name of names) {
    const source = xmlPart(archive, name)
    if (source !== null) {
      xml.set(name, source)
      trees.set(name, await parseXml(source, yieldTask))
    }
  }
  const root = trees.get('word/document.xml')
  if (!root || !isW(root, 'document') || !child(root, 'body'))
    throw new Error('No Word document body')
  const styles = trees.has('word/styles.xml')
    ? descendants(trees.get('word/styles.xml')!, W, 'style')
        .filter((n) => attr(n, 'type') === 'paragraph')
        .map((n) => ({
          id: attr(n, 'styleId') ?? '',
          name: attr(child(n, 'name'), 'val') ?? '',
          heading:
            !!child(child(n, 'pPr') ?? n, 'outlineLvl') ||
            /heading\s*[1-9]/i.test(attr(child(n, 'name'), 'val') ?? ''),
        }))
    : []
  const tables: WordTable[] = descendants(root, W, 'tbl').map((node, i) => ({
    number: i + 1,
    node,
    rows: node.children.filter((n) => isW(n, 'tr')),
  }))
  const tableByNode = new Map(tables.map((table) => [table.node, table]))
  const paragraphs: WordParagraph[] = []
  for (const [part, tree] of trees) {
    if (part === 'word/styles.xml') continue
    const source = xml.get(part)!
    let fieldDepth = 0
    for (const node of descendants(tree, W, 'p')) {
      const runs: TextRun[] = []
      let text = ''
      let unsupportedAncestor = false
      for (let parent = node.parent; parent; parent = parent.parent)
        if (parent.ns !== W || !['document', 'body', 'tc', 'tr', 'tbl'].includes(parent.local))
          unsupportedAncestor = true
      const nonPlainParagraph = /<!--|<!\[CDATA\[|<\?/.test(
        source.slice(node.openEnd, node.closeStart)
      )
      let protectedParagraph =
        nonPlainParagraph ||
        unsupportedAncestor ||
        !!fieldDepth ||
        ['ins', 'del', 'moveFrom', 'moveTo', 'sdt', 'fldSimple'].some(
          (name) => !!ancestor(node, name)
        )
      let unsupported =
        nonPlainParagraph ||
        unsupportedAncestor ||
        !!fieldDepth ||
        part !== 'word/document.xml' ||
        !!ancestor(node, 'sdt') ||
        !!ancestor(node, 'ins') ||
        !!ancestor(node, 'del')
      for (const n of descendants(node)) {
        if (n !== node && isW(n, 'p')) continue
        if (isW(n, 'fldChar')) {
          const type = attr(n, 'fldCharType')
          if (type === 'begin') fieldDepth++
          if (type === 'end') fieldDepth = Math.max(0, fieldDepth - 1)
          unsupported = true
          protectedParagraph = true
        }
        if (['ins', 'del', 'moveFrom', 'moveTo', 'sdt', 'fldSimple'].some((name) => isW(n, name)))
          protectedParagraph = true
        if (
          [
            'ins',
            'del',
            'moveFrom',
            'moveTo',
            'sdt',
            'fldSimple',
            'drawing',
            'object',
            'pict',
            'commentRangeStart',
            'footnoteReference',
            'endnoteReference',
            'sectPr',
            'bookmarkStart',
          ].some((name) => isW(n, name))
        )
          unsupported = true
        if (ancestor(n, 'del') || ancestor(n, 'moveFrom')) continue
        if (isW(n, 't')) {
          const lexicalText = source.slice(n.openEnd, n.closeStart)
          const nonPlainText = lexicalText.includes('<')
          if (nonPlainText) {
            unsupported = true
            protectedParagraph = true
          }
          const value = decodeXmlContent(lexicalText)
          let unknownTextContainer = unsupportedAncestor
          for (let parent = n.parent; parent && parent !== node; parent = parent.parent)
            if (
              parent.ns !== W ||
              !['r', 'hyperlink', 'ins', 'del', 'moveFrom', 'moveTo', 'sdt', 'fldSimple'].includes(
                parent.local
              )
            )
              unknownTextContainer = true
          if (unknownTextContainer) {
            unsupported = true
            protectedParagraph = true
          }
          const protectedRun =
            nonPlainText ||
            unknownTextContainer ||
            !!fieldDepth ||
            ['ins', 'del', 'moveFrom', 'moveTo', 'fldSimple', 'sdt'].some(
              (name) => !!ancestor(n, name)
            )
          runs.push({
            node: n,
            run: ancestor(n, 'r'),
            text: value,
            offset: text.length,
            protected: protectedRun,
          })
          text += value
        } else if (isW(n, 'tab')) text += '\t'
        else if (isW(n, 'br') || isW(n, 'cr')) text += '\n'
      }
      const tbl = ancestor(node, 'tbl')
      const table = tbl ? tableByNode.get(tbl) : undefined
      const tr = ancestor(node, 'tr')
      const tc = ancestor(node, 'tc')
      paragraphs.push({
        number: paragraphs.length + 1,
        part,
        node,
        text,
        runs,
        style: attr(child(child(node, 'pPr') ?? node, 'pStyle'), 'val'),
        table: table?.number,
        row: table && tr ? table.rows.indexOf(tr) + 1 : undefined,
        cell:
          tr && tc
            ? tr.children
                .filter((c) => isW(c, 'tc'))
                .slice(0, tr.children.filter((c) => isW(c, 'tc')).indexOf(tc))
                .reduce(
                  (n, c) => n + Number(attr(child(child(c, 'tcPr') ?? c, 'gridSpan'), 'val') || 1),
                  1
                )
            : undefined,
        editable: !unsupported,
        protected: protectedParagraph,
      })
    }
  }
  const links: { paragraph: number; from: number; to: number; url: string }[] = []
  const relTree = trees.get('word/_rels/document.xml.rels')
  const targets = new Map(
    relTree
      ? descendants(relTree, REL, 'Relationship').map((n) => [n.attrs.Id, n.attrs.Target])
      : []
  )
  for (const p of paragraphs)
    for (const link of descendants(p.node, W, 'hyperlink')) {
      const runs = p.runs.filter((r) => ancestor(r.node, 'hyperlink') === link)
      if (runs.length)
        links.push({
          paragraph: p.number,
          from: runs[0].offset,
          to: runs.at(-1)!.offset + runs.at(-1)!.text.length,
          url:
            targets.get(attr(link, 'id', R) ?? '') ??
            (attr(link, 'anchor') ? '#' + attr(link, 'anchor') : '(unresolved link)'),
        })
    }
  const paragraphByNode = new Map(paragraphs.map((p) => [p.node, p]))
  const images: WordImage[] = []
  for (const drawing of descendants(root, W, 'drawing')) {
    const layout = drawing.children.find(
      (n) => n.ns === WP && ['inline', 'anchor'].includes(n.local)
    )
    const blip = descendants(drawing, A, 'blip')[0]
    const parent = ancestor(drawing, 'p')
    const p = parent ? paragraphByNode.get(parent) : undefined
    if (!layout || !blip || !p) continue
    const extent = layout.children.find((n) => n.ns === WP && n.local === 'extent')
    images.push({
      number: images.length + 1,
      paragraph: p.number,
      node: layout,
      drawing,
      inline: layout.local === 'inline',
      relId: attr(blip, 'embed', R) ?? '',
      width: Number(extent?.attrs.cx || 0) / 9525,
      height: Number(extent?.attrs.cy || 0) / 9525,
      protected:
        p.protected ||
        ['ins', 'del', 'moveFrom', 'moveTo', 'sdt', 'fldSimple'].some(
          (name) => !!ancestor(drawing, name)
        ),
    })
  }
  const doc: WordPackage = {
    original,
    archive,
    xml,
    trees,
    paragraphs,
    tables,
    styles,
    images,
    links,
    richPreview:
      archive.entries.reduce((n, e) => n + e.size, 0) <= 16 * 1024 * 1024 &&
      paragraphs.length <= 400 &&
      original.length <= 4 * 1024 * 1024 &&
      (xml.get('word/document.xml')?.length ?? 0) < 500_000,
    read(start, count, max) {
      return paragraphs
        .slice(start - 1, start - 1 + count)
        .map(
          (p) =>
            `[${p.number}] (${p.part}${p.table ? `, table ${p.table} row ${p.row} cell ${p.cell}` : ''}${p.style ? `, ${p.style}` : ''}${p.editable ? '' : ', read-only structure'})\n${p.text}`
        )
        .join('\n\n')
        .slice(0, max)
    },
    search(query, after, limit) {
      const q = query.toLowerCase()
      let total = 0
      const finds: { paragraph: number; offset: number; length: number; excerpt: string }[] = []
      if (!q) return { total, finds }
      for (const p of paragraphs) {
        const folded = foldedWordText(p.text)
        for (let at = folded.text.indexOf(q); at >= 0; at = folded.text.indexOf(q, at + q.length)) {
          if (total >= after && finds.length < limit) {
            const range = folded.range(at, at + q.length)
            finds.push({
              paragraph: p.number,
              ...range,
              excerpt: p.text.slice(
                Math.max(0, range.offset - 80),
                range.offset + range.length + 80
              ),
            })
          }
          total++
        }
      }
      return { total, finds }
    },
  }
  return doc
}
