/** OOXML package model over bytes, with no vault or Obsidian dependency. */
import { openZip, type ZipLoader } from '@/reader/zipLoader'
import { strToU8, zip } from 'fflate'
import {
  ancestor,
  attr,
  child,
  decodeXml,
  descendants,
  isW,
  parseXml,
  W,
  type XmlNode,
} from './xml'

export const MAX_XML = 8 * 1024 * 1024
export const MAX_ARCHIVE = 32 * 1024 * 1024
export const MAX_EXPANDED = 96 * 1024 * 1024
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
  richPreview: boolean
  read(start: number, count: number, max: number): string
  search(
    query: string,
    after: number,
    limit: number
  ): { total: number; finds: { paragraph: number; offset: number; excerpt: string }[] }
}
export const pack = (parts: Record<string, Uint8Array>): Promise<Uint8Array> =>
  new Promise((resolve, reject) =>
    zip(parts, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data)))
  )
export async function saveParts(
  doc: WordPackage,
  changed: Map<string, Uint8Array | null>
): Promise<Uint8Array> {
  if (!changed.size) return doc.original
  const parts: Record<string, Uint8Array> = {}
  for (const entry of doc.archive.entries) {
    const bytes = changed.has(entry.filename)
      ? changed.get(entry.filename)
      : doc.archive.loadBytes(entry.filename)
    if (bytes) parts[entry.filename] = bytes
  }
  for (const [name, bytes] of changed) if (bytes) parts[name] = bytes
  return pack(parts)
}
export async function openDocx(original: Uint8Array): Promise<WordPackage> {
  if (original.length > MAX_ARCHIVE)
    throw new Error('Document is too large (32 MB compressed limit)')
  const archive = openZip(original)
  if (
    archive.entries.length > 4000 ||
    new Set(archive.entries.map((e) => e.filename)).size !== archive.entries.length
  )
    throw new Error('Too many or duplicate document parts')
  if (archive.entries.reduce((n, e) => n + e.size, 0) > MAX_EXPANDED)
    throw new Error('Document is too large unpacked')
  for (const e of archive.entries) {
    if (e.filename.endsWith('.xml') && e.size > MAX_XML)
      throw new Error('Document XML is too large')
    if (e.filename.startsWith('/') || e.filename.split('/').includes('..'))
      throw new Error('Invalid document part path')
  }
  const xml = new Map<string, string>()
  const trees = new Map<string, XmlNode>()
  const names = [
    'word/document.xml',
    'word/styles.xml',
    ...archive.entries
      .filter((e) =>
        /^word\/(?:header\d+|footer\d+|comments|footnotes|endnotes)\.xml$/.test(e.filename)
      )
      .map((e) => e.filename),
  ]
  for (const name of names) {
    const source = archive.loadText(name)
    if (source !== null) {
      xml.set(name, source)
      trees.set(name, await parseXml(source))
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
  const paragraphs: WordParagraph[] = []
  for (const [part, tree] of trees) {
    if (part === 'word/styles.xml') continue
    const source = xml.get(part)!
    for (const node of descendants(tree, W, 'p')) {
      const runs: TextRun[] = []
      let text = ''
      let fieldDepth = 0
      let unsupported =
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
        }
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
          const value = decodeXml(source.slice(n.openEnd, n.closeStart))
          const protectedRun =
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
      const table = tables.find((t) => t.node === tbl)
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
        cell: tr && tc ? tr.children.filter((c) => isW(c, 'tc')).indexOf(tc) + 1 : undefined,
        editable: !unsupported,
      })
    }
  }
  const doc: WordPackage = {
    original,
    archive,
    xml,
    trees,
    paragraphs,
    tables,
    styles,
    richPreview:
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
      const finds: { paragraph: number; offset: number; excerpt: string }[] = []
      if (!q) return { total, finds }
      for (const p of paragraphs) {
        const lower = p.text.toLowerCase()
        for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + q.length)) {
          if (total >= after && finds.length < limit)
            finds.push({
              paragraph: p.number,
              offset: at,
              excerpt: p.text.slice(Math.max(0, at - 80), at + q.length + 80),
            })
          total++
        }
      }
      return { total, finds }
    },
  }
  return doc
}
export const xmlBytes = (source: string) => strToU8(source)
