import { saveParts, xmlBytes, type WordPackage, type WordParagraph } from './package'
import { escapeXml, patchXml, type Patch } from './xml'

export interface WordEdit {
  operation: 'replace' | 'insert'
  paragraph: number
  old_text?: string
  new_text?: string
  offset?: number
  text?: string
}
export function paragraphOf(doc: WordPackage, number: number): WordParagraph {
  if (!Number.isInteger(number)) throw new Error('Paragraph must be an integer from 1')
  const p = doc.paragraphs[number - 1]
  if (!p) throw new Error('No such paragraph')
  if (p.part !== 'word/document.xml') throw new Error('Supplementary parts are read-only')
  return p
}
export function validText(text: unknown): asserts text is string {
  if (
    typeof text !== 'string' ||
    text.length > 100_000 ||
    Array.from(text).some((char) => {
      const n = char.codePointAt(0)!
      return (
        (n < 32 && ![9, 10, 13].includes(n)) ||
        (n >= 0xd800 && n <= 0xdfff) ||
        n === 0xfffe ||
        n === 0xffff
      )
    })
  )
    throw new Error('Invalid or excessively long Word text')
  if (/[\r\n\t]/.test(text))
    throw new Error('Use paragraph operations for new lines; tabs are not plain run text')
}
export function textPatches(
  doc: WordPackage,
  p: WordParagraph,
  start: number,
  end: number,
  replacement: string
): Patch[] {
  validText(replacement)
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > p.text.length
  )
    throw new Error('Invalid text range')
  for (const at of [start, end])
    if (
      at > 0 &&
      at < p.text.length &&
      /[\ud800-\udbff]/.test(p.text[at - 1]) &&
      /[\udc00-\udfff]/.test(p.text[at])
    )
      throw new Error('Range splits a Unicode character')
  const touched = p.runs
    .filter((r) =>
      end > start
        ? r.offset < end && r.offset + r.text.length > start
        : r.offset <= start && r.offset + r.text.length >= start
    )
    .slice(0, end === start ? 1 : undefined)
  if (!touched.length) throw new Error('No editable text at this position')
  if (touched.some((r) => r.protected))
    throw new Error('Protected revisions and fields are read-only')
  if (
    end > start &&
    touched
      .map((r) =>
        r.text.slice(Math.max(0, start - r.offset), Math.min(r.text.length, end - r.offset))
      )
      .join('') !== p.text.slice(start, end)
  )
    throw new Error('Range crosses a non-text element')
  const source = doc.xml.get(p.part)!
  const patches: Patch[] = []
  touched.forEach((r, i) => {
    const from = Math.max(0, start - r.offset)
    const to = Math.max(from, Math.min(r.text.length, end - r.offset))
    const next = r.text.slice(0, from) + (i === 0 ? replacement : '') + r.text.slice(to)
    if (next === r.text) return
    patches.push({ start: r.node.openEnd, end: r.node.closeStart, text: escapeXml(next) })
    if (/^\s|\s$/.test(next) && r.node.attrs['xml:space'] !== 'preserve') {
      const open = source.slice(r.node.start, r.node.openEnd)
      patches.push({
        start: r.node.start,
        end: r.node.openEnd,
        text: open.includes('xml:space=')
          ? open.replace(/xml:space\s*=\s*(?:"[^"]*"|'[^']*')/, 'xml:space="preserve"')
          : open.replace(/>$/, ' xml:space="preserve">'),
      })
    }
  })
  return patches
}
export async function applyWordEdit(doc: WordPackage, edit: WordEdit): Promise<Uint8Array> {
  const p = paragraphOf(doc, edit.paragraph)
  let start: number
  let end: number
  let text: string
  if (edit.operation === 'replace') {
    validText(edit.old_text)
    validText(edit.new_text)
    if (!edit.old_text) throw new Error('Replacement requires nonempty old_text')
    start = p.text.indexOf(edit.old_text)
    if (start < 0 || p.text.indexOf(edit.old_text, start + 1) >= 0)
      throw new Error('old_text must have one unique match in the paragraph')
    end = start + edit.old_text.length
    text = edit.new_text
  } else if (edit.operation === 'insert') {
    validText(edit.text)
    start = edit.offset ?? p.text.length
    end = start
    text = edit.text
  } else throw new Error('Unknown Word operation')
  const patches = textPatches(doc, p, start, end, text)
  if (!patches.length) return doc.original
  return saveParts(doc, new Map([[p.part, xmlBytes(patchXml(doc.xml.get(p.part)!, patches))]]))
}
