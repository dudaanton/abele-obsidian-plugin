import { splitMarkdown } from '@/github/markdownBlocks'
import { markdownLinkTargets } from '@/helpers/markdownLinkTargets'
import type { Deck, SlideSource } from './model'

const escapeLabel = (value: string) =>
  value.replace(/[\\[\]*_`<>]/g, '\\$&').replace(/[\r\n]+/g, ' ')
const linkMarkdown = (label: string, target: string) =>
  `[${escapeLabel(label)}](${target.replace(/[\s<>]/g, (char) => encodeURIComponent(char))})`
const plainLabel = (value: string) =>
  value.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '')

/** Collect ordinary Markdown/reference links, wikilinks and HTTP(S) autolinks from notes.
 * Code examples and images are not citations. Kept independent of the host renderer. */
export function noteSources(source: string): SlideSource[] {
  const lines = source.split('\n')
  for (const block of splitMarkdown('\n' + source)) {
    if (block.kind !== 'code') continue
    for (let i = block.start - 2; i <= block.end - 2; i++) lines[i] = ''
  }
  const text = lines.join('\n').replace(/(`+)[\s\S]*?\1/g, '')
  const definitions = new Map<string, string>()
  const referenceKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
  for (const m of text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm))
    definitions.set(referenceKey(m[1]), m[2])
  const links: { index: number; source: SlideSource }[] = []
  const occupied: [number, number][] = []
  for (const image of text.matchAll(/!\[[^\]\n]*\]\[[^\]\n]*\]|!\[\[[^\]\n]+\]\]/g))
    occupied.push([image.index, image.index + image[0].length])
  for (const token of markdownLinkTargets(text)) {
    const closeLabel = text.lastIndexOf(']', token.start)
    if (text[closeLabel + 1] !== '(' || text[token.labelStart - 1] === '!') continue
    const label = text.slice(token.labelStart + 1, closeLabel)
    const target = text.slice(token.start, token.end).replace(/\\([()])/g, '$1')
    // Only safe external links and ordinary relative note paths are source destinations.
    if (/^[a-z][\w+.-]*:/i.test(target) && !/^https?:/i.test(target)) continue
    const close = text.indexOf(')', token.end)
    occupied.push([token.labelStart, close < 0 ? token.end : close + 1])
    links.push({
      index: token.labelStart,
      source: {
        label: plainLabel(label) || target,
        target,
        markdown: linkMarkdown(plainLabel(label) || target, target),
      },
    })
  }
  const available = (index: number) =>
    !occupied.some(([start, end]) => index >= start && index < end)
  for (const m of text.matchAll(
    /(?<!!)\[\[([^\]\n]+)\]\]|(?<!!)\[([^\]\n]+)\](?:\[([^\]\n]*)\])?|<(https?:\/\/[^\s<>]+)>/g
  )) {
    if (!available(m.index)) continue
    if (m[1]) {
      const [target, alias] = m[1].split('|')
      links.push({ index: m.index, source: { label: alias || target, target, markdown: m[0] } })
    } else if (m[4]) {
      links.push({
        index: m.index,
        source: { label: m[4], target: m[4], markdown: linkMarkdown(m[4], m[4]) },
      })
    } else {
      if (text[m.index + m[0].length] === ':') continue
      const target = definitions.get(referenceKey(m[3] || m[2]))
      if (!target || (/^[a-z][\w+.-]*:/i.test(target) && !/^https?:/i.test(target))) continue
      links.push({
        index: m.index,
        source: {
          label: plainLabel(m[2]),
          target,
          markdown: linkMarkdown(plainLabel(m[2]), target),
        },
      })
    }
  }
  const seen = new Set<string>()
  return links
    .sort((a, b) => a.index - b.index)
    .flatMap(({ source }) => {
      if (seen.has(source.target)) return []
      seen.add(source.target)
      return [source]
    })
}

/** Derived audience model. Codec/edit tools retain only authored slides. Export can reuse it. */
export function presentationDeck(deck: Deck): Deck {
  const slides: Deck['slides'] = deck.slides
    .filter((slide) => !slide.generated)
    .map((slide) => {
      const sources = noteSources(slide.notes.map((note) => note.source).join('\n\n'))
      return { ...slide, sources }
    })
  const groups = slides.flatMap((slide, index) =>
    slide.sources?.length
      ? [
          `### ${index + 1}. ${escapeLabel(plainLabel(slide.title || 'Untitled slide'))}\n${slide.sources.map((source) => '- ' + source.markdown).join('\n')}`,
        ]
      : []
  )
  if (groups.length)
    slides.push({
      title: 'Sources',
      generated: 'sources',
      sources: [],
      settings: {
        layout: 'content',
        bg: '',
        dim: 0,
        fit: 'cover',
        autoplay: false,
        className: '',
        attributes: {},
      },
      regions: [
        {
          name: 'body',
          blocks: [{ type: 'markdown', source: '# Sources\n\n' + groups.join('\n\n') }],
        },
      ],
      notes: [],
    })
  return { ...deck, slides }
}
