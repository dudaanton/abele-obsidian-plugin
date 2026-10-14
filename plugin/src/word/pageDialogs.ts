// What the page's windows need to know before they open: the words a link goes on, and the size a
// picture from the vault comes into the document at. Nothing here touches Obsidian.
import { allParagraphs, paragraphText, type WordPageEdit, type WordPageModel } from './pageModel'

/** The words a link goes on, cut short when long — none when it is the whole paragraph — and
 *  the address already on them. */
export function linkAsk(
  model: WordPageModel,
  edit: Omit<WordPageEdit, 'url'>
): { words: string; current?: string } | undefined {
  const p = allParagraphs(model).find((p) => p.number === edit.paragraph)
  if (!p) return undefined
  const text = paragraphText(p)
  const from = edit.from ?? 0
  const to = edit.to ?? text.length
  const words = from === 0 && to === text.length ? '' : text.slice(from, to)
  let at = 0
  let current: string | undefined
  for (const run of p.runs) {
    if (run.link && at < to && at + run.text.length > from) current = run.link
    at += run.text.length
  }
  return { words: words.length > 40 ? `${words.slice(0, 40)}…` : words, current }
}

/** A picture's own size in pixels, read from its header; undefined when it cannot be told. */
export function pictureSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const at = (i: number) => bytes[i] ?? 0
  const be16 = (i: number) => (at(i) << 8) | at(i + 1)
  const le16 = (i: number) => at(i) | (at(i + 1) << 8)
  const le24 = (i: number) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16)
  const be32 = (i: number) =>
    ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0
  const tag = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n))
  let size: { width: number; height: number } | undefined
  if (at(0) === 0x89 && tag(1, 3) === 'PNG') size = { width: be32(16), height: be32(20) }
  else if (tag(0, 4) === 'GIF8') size = { width: le16(6), height: le16(8) }
  else if (tag(0, 4) === 'RIFF' && tag(8, 4) === 'WEBP') {
    const kind = tag(12, 4)
    if (kind === 'VP8X') size = { width: 1 + le24(24), height: 1 + le24(27) }
    else if (kind === 'VP8 ') size = { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff }
    else if (kind === 'VP8L')
      size = {
        width: 1 + (((at(22) & 0x3f) << 8) | at(21)),
        height: 1 + (((at(24) & 0xf) << 10) | (at(23) << 2) | ((at(22) & 0xc0) >> 6)),
      }
  } else if (at(0) === 0xff && at(1) === 0xd8) {
    // A JPEG says its size in the first start-of-frame marker; the ones between are skipped.
    for (let i = 2; i + 9 < bytes.length; ) {
      if (at(i) !== 0xff) return undefined
      const marker = at(i + 1)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        size = { width: be16(i + 7), height: be16(i + 5) }
        break
      }
      i += 2 + be16(i + 2)
    }
  }
  return size && size.width > 0 && size.height > 0 ? size : undefined
}

/** The text width of a Word page with its default margins, in pixels. */
const PAGE_TEXT_WIDTH = 624

/** As Word puts a picture in: its own size, made smaller in proportion to fit the page's text
 *  width; a picture whose size cannot be read comes in at a modest one. */
export function insertSize(size: { width: number; height: number } | undefined) {
  if (!size) return { width: 320, height: 240 }
  if (size.width <= PAGE_TEXT_WIDTH) return size
  return {
    width: PAGE_TEXT_WIDTH,
    height: Math.max(1, Math.round((size.height * PAGE_TEXT_WIDTH) / size.width)),
  }
}
