import type { WordPackage, WordParagraph } from './package'
import type {
  WordMark,
  WordPageBlock,
  WordPageImage,
  WordPageModel,
  WordPageParagraph,
  WordPageRun,
} from './pageModel'
import { ancestor, attr, child, descendants, isW, parseXml, REL, W, type XmlNode } from './xml'
import { imageResource } from './imageOps'

/** Presentation only: edits always operate on the untouched package, not this projection. */
export async function wordPageModel(doc: WordPackage): Promise<WordPageModel> {
  const cellInfo = new Map<
    XmlNode,
    { row: number; column: number; colSpan: number; rowSpan: number }
  >()
  for (const table of doc.tables) {
    const active = new Map<
      number,
      { row: number; column: number; colSpan: number; rowSpan: number }
    >()
    table.rows.forEach((row, index) => {
      let column = 1
      for (const cell of row.children.filter((n) => isW(n, 'tc'))) {
        const properties = child(cell, 'tcPr')
        const colSpan = Math.max(
          1,
          Number(attr(properties && child(properties, 'gridSpan'), 'val') ?? 1)
        )
        const merge = properties && child(properties, 'vMerge')
        const head = merge && attr(merge, 'val') !== 'restart' ? active.get(column) : undefined
        if (head) {
          head.rowSpan++
          cellInfo.set(cell, head)
        } else {
          const info = { row: index, column, colSpan, rowSpan: 1 }
          cellInfo.set(cell, info)
          if (merge) active.set(column, info)
          else active.delete(column)
        }
        column += colSpan
      }
    })
  }
  const numberingText = doc.archive.loadText('word/numbering.xml')
  const numbering = numberingText ? await parseXml(numberingText) : null
  const listKinds = new Map<string, 'bullet' | 'decimal'>()
  if (numbering) {
    const abstracts = new Map(
      descendants(numbering, W, 'abstractNum').map((n) => [attr(n, 'abstractNumId'), n])
    )
    for (const num of descendants(numbering, W, 'num')) {
      const abstract = abstracts.get(attr(child(num, 'abstractNumId'), 'val'))
      if (!abstract) continue
      for (const level of descendants(abstract, W, 'lvl')) {
        const format = attr(child(level, 'numFmt'), 'val')
        if (format === 'bullet' || format === 'decimal')
          listKinds.set(`${attr(num, 'numId')}:${attr(level, 'ilvl') ?? '0'}`, format)
      }
    }
  }
  const links = new Map<number, typeof doc.links>()
  for (const link of doc.links)
    links.set(link.paragraph, [...(links.get(link.paragraph) ?? []), link])
  const paragraph = (p: WordParagraph): WordPageParagraph => {
    const num = child(child(p.node, 'pPr') ?? p.node, 'numPr')
    const runs: WordPageRun[] = []
    let offset = 0
    for (const run of p.runs) {
      if (run.offset > offset) runs.push({ text: p.text.slice(offset, run.offset) })
      const properties = run.run && child(run.run, 'rPr')
      const marks: WordMark[] = []
      for (const [mark, name] of [
        ['bold', 'b'],
        ['italic', 'i'],
        ['underline', 'u'],
        ['strike', 'strike'],
      ] as const) {
        const node = properties && child(properties, name)
        if (node && !['0', 'false', 'off', 'none'].includes(attr(node, 'val') ?? ''))
          marks.push(mark)
      }
      const link = links
        .get(p.number)
        ?.find((link) => link.from <= run.offset && link.to >= run.offset + run.text.length)
      runs.push({
        text: run.text,
        marks,
        link: link && /^(https?:|mailto:)/i.test(link.url) ? link.url : undefined,
      })
      offset = run.offset + run.text.length
    }
    if (offset < p.text.length) runs.push({ text: p.text.slice(offset) })
    const cell = ancestor(p.node, 'tc')
    const info = cell && cellInfo.get(cell)
    return {
      kind: 'paragraph',
      number: p.number,
      style: p.style,
      locked: !p.editable,
      cell: info?.column ?? p.cell,
      colSpan: info?.colSpan,
      rowSpan: info?.rowSpan,
      list: num
        ? listKinds.get(
            `${attr(child(num, 'numId'), 'val')}:${attr(child(num, 'ilvl'), 'val') ?? '0'}`
          )
        : undefined,
      runs,
    }
  }
  const blocks: WordPageBlock[] = []
  const projectedByNumber = new Map<number, WordPageParagraph>()
  const tables = new Map<number, Extract<WordPageBlock, { kind: 'table' }>>()
  const imageBlocks = new Map<number, WordPageImage[]>()
  const relationships = doc.trees.get('word/_rels/document.xml.rels')
  const targets = new Map(
    relationships
      ? descendants(relationships, REL, 'Relationship')
          .filter((n) => n.attrs.TargetMode !== 'External')
          .map((n) => [n.attrs.Id, n.attrs.Target])
      : []
  )
  for (const image of doc.images) {
    const target = targets.get(image.relId)
    if (!target || /(^\/|:|\\|\.\.)/.test(target)) continue
    const bytes = doc.archive.loadBytes(`word/${target.replace(/^\.\//, '')}`)
    if (!bytes) continue
    try {
      const { mime } = imageResource(bytes)
      let binary = ''
      for (let at = 0; at < bytes.length; at += 8192)
        binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
      const block: WordPageImage = {
        kind: 'image',
        number: image.number,
        paragraph: image.paragraph,
        src: `data:${mime};base64,${btoa(binary)}`,
        alt: `Image ${image.number}`,
        width: image.width,
        height: image.height,
      }
      imageBlocks.set(image.paragraph, [...(imageBlocks.get(image.paragraph) ?? []), block])
    } catch {
      // Unsupported media stays in the package; never execute it in the app document.
    }
  }
  for (const p of doc.paragraphs) {
    const projected = paragraph(p)
    projectedByNumber.set(p.number, projected)
    if (p.table) {
      let table = tables.get(p.table)
      if (!table) {
        table = { kind: 'table', number: p.table, rows: [] }
        tables.set(p.table, table)
        blocks.push(table)
      }
      const cell = ancestor(p.node, 'tc')
      const row = (cell && cellInfo.get(cell)?.row) ?? (p.row ?? 1) - 1
      while (table.rows.length <= row) table.rows.push([])
      table.rows[row].push(projected)
      projected.images = imageBlocks.get(p.number)
    } else blocks.push(projected)
    if (!p.table) blocks.push(...(imageBlocks.get(p.number) ?? []))
  }
  for (const table of doc.tables) {
    const parentCell = ancestor(table.node, 'tc')
    if (!parentCell) continue
    const candidates = doc.paragraphs.filter((p) => ancestor(p.node, 'tc') === parentCell)
    const preceding = candidates.filter((p) => p.node.start < table.node.start).at(-1)
    const anchor = preceding ?? candidates[0]
    const nested = tables.get(table.number)
    const projected = anchor && projectedByNumber.get(anchor.number)
    if (!nested || !projected) continue
    const key = preceding ? 'afterTables' : 'beforeTables'
    projected[key] = [...(projected[key] ?? []), nested]
    const index = blocks.indexOf(nested)
    if (index >= 0) blocks.splice(index, 1)
  }
  return { blocks, styles: doc.styles }
}
