import type { WordPackage, WordParagraph, TextRun } from './package'
import {
  ancestor,
  carryNamespaces,
  child,
  descendants,
  escapeXml,
  isW,
  patchXml,
  preserveXmlSpace,
  rawNode,
  W,
  type Patch,
  type XmlNode,
} from './xml'

export const wTag = (name: string, content = '', attributes = '') =>
  `<w:${name} xmlns:w="${W}"${attributes ? ' ' + attributes : ''}>${content}</w:${name}>`
export const textRun = (text: string) =>
  wTag('r', `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`)
export const isEmptyNode = (source: string, n: XmlNode) =>
  /\/\s*>$/.test(source.slice(n.start, n.openEnd))
export function nodeWithContent(source: string, n: XmlNode, content: string): string {
  const open = source.slice(n.start, n.openEnd)
  return isEmptyNode(source, n)
    ? open.replace(/\/\s*>$/, '>') + content + `</${n.name}>`
    : open + content + source.slice(n.closeStart, n.end)
}
const ORDERS: Record<string, string[]> = {
  pPr: [
    'pStyle',
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'framePr',
    'widowControl',
    'numPr',
    'suppressLineNumbers',
    'pBdr',
    'shd',
    'tabs',
    'suppressAutoHyphens',
    'kinsoku',
    'wordWrap',
    'overflowPunct',
    'topLinePunct',
    'autoSpaceDE',
    'autoSpaceDN',
    'bidi',
    'adjustRightInd',
    'snapToGrid',
    'spacing',
    'ind',
    'contextualSpacing',
    'mirrorIndents',
    'suppressOverlap',
    'jc',
    'textDirection',
    'textAlignment',
    'textboxTightWrap',
    'outlineLvl',
    'divId',
    'cnfStyle',
    'rPr',
    'sectPr',
    'pPrChange',
  ],
  rPr: [
    'rStyle',
    'rFonts',
    'b',
    'bCs',
    'i',
    'iCs',
    'caps',
    'smallCaps',
    'strike',
    'dstrike',
    'outline',
    'shadow',
    'emboss',
    'imprint',
    'noProof',
    'snapToGrid',
    'vanish',
    'webHidden',
    'color',
    'spacing',
    'w',
    'kern',
    'position',
    'sz',
    'szCs',
    'highlight',
    'u',
    'effect',
    'bdr',
    'shd',
    'fitText',
    'vertAlign',
    'rtl',
    'cs',
    'em',
    'lang',
    'eastAsianLayout',
    'specVanish',
    'oMath',
    'rPrChange',
  ],
  tcPr: [
    'cnfStyle',
    'tcW',
    'gridSpan',
    'hMerge',
    'vMerge',
    'tcBorders',
    'shd',
    'noWrap',
    'tcMar',
    'textDirection',
    'tcFitText',
    'vAlign',
    'hideMark',
    'headers',
    'cellIns',
    'cellDel',
    'cellMerge',
    'tcPrChange',
  ],
}
/** Surgical edit of one property; unknown attributes/children in the container survive. */
export function propertyPatches(
  source: string,
  node: XmlNode,
  containerName: string,
  property: string,
  value: string | null
): Patch[] {
  const container = child(node, containerName)
  if (!container)
    return value
      ? isEmptyNode(source, node)
        ? [
            {
              start: node.start,
              end: node.end,
              text: nodeWithContent(source, node, wTag(containerName, value)),
            },
          ]
        : [{ start: node.openEnd, end: node.openEnd, text: wTag(containerName, value) }]
      : []
  const existing = child(container, property)
  if (existing) return [{ start: existing.start, end: existing.end, text: value ?? '' }]
  if (!value) return []
  if (isEmptyNode(source, container))
    return [
      {
        start: container.start,
        end: container.end,
        text: nodeWithContent(source, container, value),
      },
    ]
  const order = ORDERS[containerName] ?? []
  const index = order.indexOf(property)
  const next = container.children.find((c) => c.ns === W && order.indexOf(c.local) > index)
  const at = next?.start ?? container.closeStart
  return [{ start: at, end: at, text: value }]
}
export function propertyNode(
  source: string,
  node: XmlNode,
  containerName: string,
  property: string,
  value: string | null
): string {
  const changes = propertyPatches(source, node, containerName, property, value)
  if (isEmptyNode(source, node) && changes.length)
    return nodeWithContent(source, node, wTag(containerName, value ?? ''))
  return patchXml(
    rawNode(source, node),
    changes.map((p) => ({ ...p, start: p.start - node.start, end: p.end - node.start }))
  )
}
export function propertiesNode(
  source: string,
  node: XmlNode,
  containerName: string,
  values: Record<string, string | null>
): string {
  const container = child(node, containerName)
  const order = ORDERS[containerName] ?? []
  const entries = Object.entries(values).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
  if (!container || isEmptyNode(source, container)) {
    const content = entries.map(([, v]) => v ?? '').join('')
    const next = container
      ? nodeWithContent(source, container, content)
      : wTag(containerName, content)
    const at = container?.start ?? node.openEnd
    const end = container?.end ?? at
    return patchXml(rawNode(source, node), [
      { start: at - node.start, end: end - node.start, text: next },
    ])
  }
  const edits = entries.flatMap(([key, val]) =>
    propertyPatches(source, node, containerName, key, val)
  )
  const inserts = new Map<number, Patch>()
  const patches: Patch[] = []
  for (const edit of edits) {
    if (edit.start === edit.end) {
      const earlier = inserts.get(edit.start)
      if (earlier) earlier.text += edit.text
      else inserts.set(edit.start, { ...edit })
    } else patches.push(edit)
  }
  return patchXml(
    rawNode(source, node),
    [...patches, ...inserts.values()].map((p) => ({
      ...p,
      start: p.start - node.start,
      end: p.end - node.start,
    }))
  )
}

/** Structural edits are allowed only where every container is understood. */
export function assertPlain(p: WordParagraph, allowDrawing = false): void {
  if (
    p.protected ||
    p.part !== 'word/document.xml' ||
    ['ins', 'del', 'moveFrom', 'moveTo', 'sdt', 'fldSimple', 'customXml', 'txbxContent'].some(
      (n) => !!ancestor(p.node, n)
    )
  )
    throw new Error('Protected structure is read-only')
  const visit = (node: XmlNode) => {
    if (isW(node, 'pPr') || isW(node, 'rPr')) {
      if (descendants(node).some((n) => ['sectPr', 'pPrChange', 'rPrChange'].includes(n.local)))
        throw new Error('Unsupported structure is read-only')
      return
    }
    if (allowDrawing && isW(node, 'drawing')) return
    if (node.ns !== W || !['p', 'r', 't', 'hyperlink', 'proofErr'].includes(node.local))
      throw new Error('Unsupported structure is read-only')
    for (const n of node.children) visit(n)
  }
  visit(p.node)
  for (const r of p.runs) {
    if (
      r.protected ||
      !r.run ||
      r.node.children.length ||
      r.run.children.filter((n) => isW(n, 't')).length !== 1
    )
      throw new Error('Unsupported text run is read-only')
  }
}
export function renderTextRun(
  doc: WordPackage,
  r: TextRun,
  value: string,
  format?: { name: string; enabled: boolean }
): string {
  if (!r.run) throw new Error('No text run')
  const source = doc.xml.get('word/document.xml')!
  let open = source.slice(r.node.start, r.node.openEnd).replace(/\/\s*>$/, '>')
  if (/^\s|\s$/.test(value) && r.node.attrs['xml:space'] !== 'preserve')
    open = preserveXmlSpace(open)
  const patches: Patch[] = [
    { start: r.node.start, end: r.node.end, text: open + escapeXml(value) + `</${r.node.name}>` },
  ]
  if (format) {
    const name = format.name
    const val = name === 'u' ? (format.enabled ? 'single' : 'none') : format.enabled ? '1' : '0'
    patches.push(...propertyPatches(source, r.run, 'rPr', name, wTag(name, '', `w:val="${val}"`)))
  }
  return patchXml(
    rawNode(source, r.run),
    patches.map((p) => ({ ...p, start: p.start - r.run!.start, end: p.end - r.run!.start }))
  )
}
/** A paragraph's inline XML sliced by text offsets, retaining hyperlink and run wrappers. */
export function inlineSlice(
  doc: WordPackage,
  p: WordParagraph,
  from: number,
  to: number,
  destination = p.node.namespaces
): string {
  if (from === to) return ''
  const source = doc.xml.get(p.part)!
  const runs = new Map(p.runs.map((r) => [r.run, r]))
  let cursor = 0
  const slice = (node: XmlNode, context: Record<string, string>): string => {
    if (isW(node, 'pPr')) return ''
    if (isW(node, 'hyperlink')) {
      const content = node.children.map((child) => slice(child, node.namespaces)).join('')
      return content ? carryNamespaces(nodeWithContent(source, node, content), node, context) : ''
    }
    const r = runs.get(node)
    if (r) {
      cursor = r.offset + r.text.length
      const begin = Math.max(0, from - r.offset)
      const end = Math.min(r.text.length, to - r.offset)
      if (begin >= end) return ''
      const fragment =
        begin === 0 && end === r.text.length
          ? rawNode(source, node)
          : renderTextRun(doc, r, r.text.slice(begin, end))
      return carryNamespaces(fragment, node, context)
    }
    // Zero-length metadata is retained on one side, never duplicated or discarded.
    return cursor >= from && (cursor < to || to === p.text.length)
      ? carryNamespaces(rawNode(source, node), node, context)
      : ''
  }
  return p.node.children.map((child) => slice(child, destination)).join('')
}
export function newParagraphWith(doc: WordPackage, p: WordParagraph, content: string): string {
  let xml = paragraphWith(doc, p, content)
  for (const name of Object.keys(p.node.attrs)) {
    const [prefix, local] = name.split(':')
    if (
      ['paraId', 'textId'].includes(local) &&
      p.node.namespaces[prefix] === 'http://schemas.microsoft.com/office/word/2010/wordml'
    )
      xml = xml.replace(
        new RegExp(`\\s${name.replaceAll('.', '\\.')}\\s*=\\s*(?:"[^"]*"|'[^']*')`),
        ''
      )
  }
  return xml
}

export function paragraphWith(doc: WordPackage, p: WordParagraph, content: string): string {
  const source = doc.xml.get(p.part)!
  const props = child(p.node, 'pPr')
  return nodeWithContent(source, p.node, (props ? rawNode(source, props) : '') + content)
}
