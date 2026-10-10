import { saveParts, xmlBytes, type WordPackage, type WordParagraph } from './package'
import { patchXml } from './xml'
import { textPatches, validText } from './textEdits'
export { textPatches, validText } from './textEdits'
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
