import { saveParts, xmlBytes, type WordPackage, type WordParagraph } from './package'
import { escapeXml, patchXml, type Patch } from './xml'
import { assertPlain, isEmptyNode, nodeWithContent, textRun } from './structure'
import { WordMutation } from './mutation'
import { paragraphOperation } from './paragraphOps'
import { tableOperation } from './tableOps'
import { imageOperation, type WordResources } from './imageOps'

export const WORD_OPERATIONS = [
  'replace',
  'insert',
  'format',
  'style',
  'list',
  'paragraph_add',
  'paragraph_split',
  'paragraph_merge',
  'paragraph_delete',
  'link',
  'row_add',
  'row_delete',
  'cells_merge',
  'cells_split',
  'image_insert',
  'image_replace',
  'image_delete',
  'image_resize',
] as const

export interface WordEdit {
  operation: (typeof WORD_OPERATIONS)[number]
  paragraph: number
  old_text?: string
  new_text?: string
  offset?: number
  text?: string
  from?: number
  to?: number
  format?: 'bold' | 'italic' | 'underline' | 'strike'
  enabled?: boolean
  style_id?: string
  list?: 'bullet' | 'decimal' | 'none'
  url?: string
  table?: number
  row?: number
  column?: number
  to_row?: number
  to_column?: number
  image?: number
  image_path?: string
  width?: number
  height?: number
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
  validText(replacement)
  // Equality is a range-level no-op: redistributing equal text would still change its formatting.
  if (p.text.slice(start, end) === replacement) return []
  const touched = p.runs
    .filter((r) =>
      end > start
        ? r.offset < end && r.offset + r.text.length > start
        : r.offset <= start && r.offset + r.text.length >= start
    )
    .slice(0, end === start ? 1 : undefined)
  if (!touched.length) {
    if (start === 0 && end === 0 && !p.text) {
      assertPlain(p)
      if (!replacement) return []
      const source = doc.xml.get(p.part)!
      if (isEmptyNode(source, p.node))
        return [
          {
            start: p.node.start,
            end: p.node.end,
            text: nodeWithContent(source, p.node, textRun(replacement)),
          },
        ]
      return [{ start: p.node.closeStart, end: p.node.closeStart, text: textRun(replacement) }]
    }
    throw new Error('No editable text at this position')
  }
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
    if (isEmptyNode(source, r.node)) {
      let open = source.slice(r.node.start, r.node.openEnd).replace(/\/\s*>$/, '>')
      if (/^\s|\s$/.test(next) && r.node.attrs['xml:space'] !== 'preserve')
        open = open.replace(/>$/, ' xml:space="preserve">')
      patches.push({
        start: r.node.start,
        end: r.node.end,
        text: open + escapeXml(next) + `</${r.node.name}>`,
      })
      return
    }
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
export async function applyWordEdit(
  doc: WordPackage,
  edit: WordEdit,
  resources?: WordResources
): Promise<Uint8Array> {
  const p = paragraphOf(doc, edit.paragraph)
  if (edit.operation !== 'replace' && edit.operation !== 'insert') {
    const mutation = new WordMutation(doc)
    const patches = edit.operation.startsWith('image_')
      ? await imageOperation(mutation, p, edit, resources)
      : ['row_add', 'row_delete', 'cells_merge', 'cells_split'].includes(edit.operation)
        ? tableOperation(mutation, edit)
        : await paragraphOperation(mutation, p, edit)
    mutation.set(p.part, patchXml(doc.xml.get(p.part)!, patches))
    return mutation.finish()
  }
  let start: number
  let end: number
  let text: string
  if (edit.operation === 'replace') {
    validText(edit.old_text)
    validText(edit.new_text)
    if (!edit.old_text) throw new Error('Replacement requires nonempty old_text')
    if (edit.offset !== undefined) {
      start = edit.offset
      if (p.text.slice(start, start + edit.old_text.length) !== edit.old_text)
        throw new Error('old_text does not match the selected text range')
    } else {
      start = p.text.indexOf(edit.old_text)
      if (start < 0 || p.text.indexOf(edit.old_text, start + 1) >= 0)
        throw new Error('old_text must have one unique match in the paragraph')
    }
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
