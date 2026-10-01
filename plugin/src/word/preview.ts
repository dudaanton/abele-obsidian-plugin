import type { WordEdit } from './edit'
import type { WordPackage } from './package'
import { attr, child, rawNode } from './xml'

/** A write preview includes structure/formatting, not just text that formatting leaves unchanged. */
export function wordPreviewText(doc: WordPackage, e: WordEdit): string {
  const paragraph = doc.paragraphs[e.paragraph - 1]
  const table = e.table ?? paragraph?.table
  const selected = table
    ? doc.paragraphs.filter((p) => p.table === table)
    : paragraph
      ? [paragraph]
      : []
  const out: string[] = []
  if (table) out.push(`Table ${table}: ${doc.tables[table - 1]?.rows.length ?? 0} rows`)
  for (const p of selected.slice(0, 200)) {
    out.push(
      `[${p.number}]${p.table ? ` row ${p.row}, grid column ${p.cell}` : ''} style: ${p.style || '(default)'}`,
      p.text
    )
    const numPr = child(child(p.node, 'pPr') ?? p.node, 'numPr')
    if (numPr)
      out.push(
        `List: ${attr(child(numPr, 'numId'), 'val')} level ${attr(child(numPr, 'ilvl'), 'val') || 0}`
      )
    if (e.operation === 'format' || e.operation === 'link')
      for (const r of p.runs.slice(0, 200)) {
        const props = r.run && child(r.run, 'rPr')
        out.push(
          `Run ${r.offset}–${r.offset + r.text.length}: ${JSON.stringify(r.text)} ${props ? rawNode(doc.xml.get(p.part)!, props) : '(default formatting)'}`
        )
      }
    for (const link of doc.links.filter((link) => link.paragraph === p.number))
      out.push(`Link ${link.from}–${link.to}: ${link.url}`)
    for (const image of doc.images.filter((i) => i.paragraph === p.number))
      out.push(
        `Image ${image.number}: ${image.inline ? 'inline' : 'floating/read-only'}, ${image.width} × ${image.height} px, relationship ${image.relId}`
      )
  }
  return out.join('\n').slice(0, 25_000)
}
