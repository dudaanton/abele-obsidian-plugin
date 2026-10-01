import { textPatches, type WordEdit } from './edit'
import type { WordParagraph } from './package'
import { A, PIC, WP } from './package'
import { WordMutation, setAttribute } from './mutation'
import { assertPlain, inlineSlice, paragraphWith, wTag } from './structure'
import { attr, descendants, escapeXml, patchXml, rawNode, R, type Patch, type XmlNode } from './xml'

export interface WordImageResource {
  bytes: Uint8Array
  extension: string
  mime: string
}
export interface WordResources {
  loadImage(path: string): Promise<WordImageResource>
}
export function imageResource(bytes: Uint8Array): WordImageResource {
  if (bytes.length > 10 * 1024 * 1024 || bytes.length < 8)
    throw new Error('Image must be a PNG, JPEG, GIF or WebP up to 10 MB')
  const header = String.fromCharCode(...bytes.slice(0, 12))
  if (bytes[0] === 137 && header.slice(1, 4) === 'PNG')
    return { bytes, extension: 'png', mime: 'image/png' }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { bytes, extension: 'jpg', mime: 'image/jpeg' }
  if (/^GIF8[79]a/.test(header)) return { bytes, extension: 'gif', mime: 'image/gif' }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP')
    return { bytes, extension: 'webp', mime: 'image/webp' }
  throw new Error('Unsupported image bytes; choose PNG, JPEG, GIF or WebP')
}
function dimensions(e: WordEdit): { cx: number; cy: number } {
  const width = e.width
  const height = e.height
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 20000 ||
    height > 20000
  )
    throw new Error('Image width/height must be positive pixels, at most 20000')
  return { cx: Math.round(width * 9525), cy: Math.round(height * 9525) }
}
async function addMedia(
  m: WordMutation,
  e: WordEdit,
  resources?: WordResources
): Promise<{ id: string; name: string }> {
  if (!resources || !e.image_path) throw new Error('Choose a vault image path')
  const resource = imageResource((await resources.loadImage(e.image_path)).bytes)
  let i = 1
  let path: string
  do {
    path = `word/media/abele-image-${i++}.${resource.extension}`
  } while (m.doc.archive.entries.some((entry) => entry.filename === path) || m.parts.has(path))
  m.parts.set(path, resource.bytes)
  await m.ensureType(path, resource.mime)
  const id = await m.relation(path.slice('word/'.length), `${R}/image`)
  return { id, name: path.split('/').at(-1)! }
}
export async function imageOperation(
  m: WordMutation,
  p: WordParagraph,
  e: WordEdit,
  resources?: WordResources
): Promise<Patch[]> {
  const source = m.doc.xml.get('word/document.xml')!
  if (e.operation === 'image_insert') {
    assertPlain(p, true)
    const { cx, cy } = dimensions(e)
    const { id, name } = await addMedia(m, e, resources)
    const ids = descendants(m.doc.trees.get('word/document.xml')!, WP, 'docPr').map((n) =>
      Number(n.attrs.id || 0)
    )
    const drawingId = Math.max(0, ...ids) + 1
    const drawing = wTag(
      'r',
      `<w:drawing><wp:inline xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawingId}" name="${escapeXml(name)}"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
    )
    const at = e.offset ?? p.text.length
    if (!Number.isInteger(at) || at < 0 || at > p.text.length)
      throw new Error('Invalid image insertion offset')
    if (at > 0 && at < p.text.length) textPatches(m.doc, p, at, at, '')
    if (at === p.text.length) {
      // Appending retains zero-length drawings and metadata already at the paragraph end.
      return [
        {
          start: p.node.start,
          end: p.node.end,
          text: paragraphWith(
            m.doc,
            p,
            p.node.children
              .filter((n) => n.local !== 'pPr')
              .map((n) => rawNode(source, n))
              .join('') + drawing
          ),
        },
      ]
    }
    return [
      {
        start: p.node.start,
        end: p.node.end,
        text: paragraphWith(
          m.doc,
          p,
          inlineSlice(m.doc, p, 0, at) + drawing + inlineSlice(m.doc, p, at, p.text.length)
        ),
      },
    ]
  }
  const image = m.doc.images[(e.image ?? 0) - 1]
  if (!image || !Number.isInteger(e.image)) throw new Error('Choose an image number from docx_read')
  if (!image.inline || image.protected)
    throw new Error('Floating or protected images are read-only')
  if (image.paragraph !== p.number) throw new Error('Image is not in the selected paragraph')
  if (e.operation === 'image_delete')
    return [{ start: image.drawing.start, end: image.drawing.end, text: '' }]
  if (e.operation === 'image_replace') {
    const { id } = await addMedia(m, e, resources)
    const blip = descendants(image.node, A, 'blip')[0]
    const prefix =
      Object.keys(blip.namespaces).find((prefix) => blip.namespaces[prefix] === R && prefix) ?? 'r'
    return [
      { start: blip.start, end: blip.end, text: setAttribute(source, blip, `${prefix}:embed`, id) },
    ]
  }
  if (e.operation === 'image_resize') {
    const { cx, cy } = dimensions(e)
    const nodes = [
      ...image.node.children.filter((n) => n.ns === WP && n.local === 'extent'),
      ...descendants(image.node, A, 'xfrm').flatMap((n) =>
        n.children.filter((c) => c.ns === A && c.local === 'ext')
      ),
    ]
    if (!nodes.length) throw new Error('Unsupported image geometry is read-only')
    return nodes.map((n) => {
      const raw = setAttribute(source, n, 'cx', String(cx))
      // Replace both plain numeric attributes without serializing shape properties.
      return {
        start: n.start,
        end: n.end,
        text: raw.replace(
          /(\scy\s*=\s*)(?:"[^"]*"|'[^']*')/,
          (_, prefix: string) => `${prefix}"${cy}"`
        ),
      }
    })
  }
  throw new Error('Unknown image operation')
}
