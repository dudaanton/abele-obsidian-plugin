/**
 * How a note on a drawing looks where the note itself cannot be shown — in the drawing's file, as
 * any app shows it, and in a picture of the drawing: a card the note's size with its name at the
 * top. In the drawing's tab the note itself is shown there (`noteLayer.ts`).
 */
import { TEXT_FONT, type NoteItem } from './items'

/** The card's paper, edge and name: literal, as the paper is, to look the same everywhere. */
export const CARD = { fill: '#ffffff', edge: '#c8c8c8', name: '#1f1f1f', rule: '#e6e6e6' }

/** The name a note goes by: its file's name without `.md`. */
export const noteName = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/** The height of the card's name, and of the band it sits in, in the drawing's units. */
export function cardTitle(item: NoteItem): { size: number; band: number; pad: number } {
  const size = 15 * item.scale
  return { size, band: size * 2, pad: size * 0.8 }
}

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const f = (n: number) => String(Math.round(n * 100) / 100)

/** The card as the drawing's file shows it. */
export function noteCardSvg(item: NoteItem): string {
  const { size, band, pad } = cardTitle(item)
  const r = 6 * item.scale
  return (
    `<g><rect x="${f(item.x)}" y="${f(item.y)}" width="${f(item.w)}" height="${f(item.h)}" rx="${f(r)}" fill="${CARD.fill}" stroke="${CARD.edge}" stroke-width="${f(item.scale)}"/>` +
    `<line x1="${f(item.x)}" y1="${f(item.y + band)}" x2="${f(item.x + item.w)}" y2="${f(item.y + band)}" stroke="${CARD.rule}" stroke-width="${f(item.scale)}"/>` +
    `<text x="${f(item.x + pad)}" y="${f(item.y + band * 0.68)}" font-family="${esc(TEXT_FONT)}" font-size="${f(size)}" font-weight="600" fill="${CARD.name}">${esc(noteName(item.path))}</text></g>`
  )
}

/** The card painted on a canvas set to the drawing's units. */
export function paintNoteCard(ctx: CanvasRenderingContext2D, item: NoteItem): void {
  const { size, band, pad } = cardTitle(item)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.beginPath()
  ctx.roundRect(item.x, item.y, item.w, item.h, 6 * item.scale)
  ctx.fillStyle = CARD.fill
  ctx.fill()
  ctx.lineWidth = item.scale
  ctx.strokeStyle = CARD.edge
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(item.x, item.y + band)
  ctx.lineTo(item.x + item.w, item.y + band)
  ctx.strokeStyle = CARD.rule
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.rect(item.x, item.y, item.w, band)
  ctx.clip()
  ctx.fillStyle = CARD.name
  ctx.font = `600 ${size}px ${TEXT_FONT}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(noteName(item.path), item.x + pad, item.y + band * 0.68)
  ctx.restore()
}
