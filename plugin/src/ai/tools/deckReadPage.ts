import type { Deck } from '@/slides/core/model'

/** Source character windows remain exact, including very long lines and JSON escaping.
 * Small decks retain the full structured reply; large ones have a bounded structural summary
 * beside each source page. The read guard accounts for source coverage, never summary text. */
export function deckReadPage(
  path: string,
  source: string,
  deck: Deck,
  params: { offset?: unknown; limit?: unknown },
  budget: number
): { text: string; from: number; to: number } {
  const from = params.offset ?? 0
  const limit = params.limit ?? budget
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0 || from > source.length)
    throw new Error(`offset must be an integer from 0 to ${source.length}`)
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)
    throw new Error('limit must be a positive integer')
  if (from === 0 && source.length <= Math.min(limit, budget)) {
    const full = JSON.stringify(
      {
        path,
        settings: deck.settings,
        css: deck.css,
        slides: deck.slides.map((slide, i) => ({ slide: i + 1, ...slide })),
        source,
        offset: 0,
        nextOffset: null,
        sourceLength: source.length,
      },
      null,
      2
    )
    if (full.length <= budget) return { text: full, from: 0, to: source.length }
  }
  const lineOffsets = [0]
  for (const newline of source.matchAll(/\r\n?|\n/g))
    lineOffsets.push(newline.index + newline[0].length)
  let first = 0
  for (let i = 0; i < deck.slides.length; i++) {
    if ((lineOffsets[deck.slides[i].sourceLine ?? 0] ?? 0) > from) break
    first = i
  }
  const slides = deck.slides.slice(first, first + 8).map((slide, i) => ({
    slide: first + i + 1,
    title: slide.title.slice(0, 80),
    settings: { layout: slide.settings.layout },
    regions: slide.regions
      .slice(0, 4)
      .map((region) => ({
        name: region.name,
        blocks: region.blocks.slice(0, 6).map((block) => block.type),
        blockCount: region.blocks.length,
      })),
    notes: slide.notes.slice(0, 4).map((note) => ({ characters: note.source.length })),
    notesCount: slide.notes.length,
  }))
  let to = Math.min(source.length, from + Math.min(limit, budget))
  const encode = () =>
    JSON.stringify(
      {
        path,
        structure: 'summary',
        settings: { aspect: deck.settings.aspect },
        cssLength: deck.css.length,
        slideCount: deck.slides.length,
        slides,
        source: source.slice(from, to),
        offset: from,
        nextOffset: to < source.length ? to : null,
        sourceLength: source.length,
        continuation:
          'Read nextOffset with deck_read.offset. Summaries omit block text and large metadata; source pages retain all original content.',
      },
      null,
      2
    )
  let text = encode()
  while (text.length > budget && to > from + 1) {
    to = from + Math.max(1, Math.floor((to - from) / 2))
    text = encode()
  }
  while (text.length > budget && slides.length) {
    slides.pop()
    text = encode()
  }
  if (text.length > budget || (to === from && from < source.length))
    throw new Error('Deck read metadata leaves no room for source within the response budget')
  return { text, from, to }
}
