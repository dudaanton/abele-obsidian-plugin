import { describe, expect, it } from 'vitest'
import { parseDeck, serializeDeck } from '@/slides/core/markdown'
import { presentationDeck } from '@/slides/core/sources'

describe('deck styling and layout markers', () => {
  it('accepts a leading deck CSS fence before the first audience layout marker', () => {
    const deck = parseDeck(
      '```css\nh1 { font-size: 40px }\n```\n\n::slide{layout=title}::\n# A short title'
    )
    expect(deck.slides[0].settings.layout).toBe('title')
    expect(deck.slides[0].regions[0].blocks[0]).toEqual({
      type: 'markdown',
      source: '# A short title',
    })
    expect(deck.css).toBe('h1 { font-size: 40px }')
  })
})

describe('derived sources slide', () => {
  it('collects note links per title, deduplicates within a slide, and never writes the derived slide', () => {
    const source =
      '# First\nBody\n\n> [!notes]\n> [Report](https://example.test/report) and [Again](https://example.test/report)\n> [[Sample reference|Reference]]\n\n---\n# Second\n\n> [!notes]\n> [Report](https://example.test/report)'
    const original = parseDeck(source)
    const deck = presentationDeck(original)
    expect(original.slides).toHaveLength(2)
    expect(deck.slides).toHaveLength(3)
    expect(deck.slides[0].sources).toHaveLength(2)
    expect(deck.slides[1].sources).toHaveLength(1)
    expect(deck.slides[2].generated).toBe('sources')
    const body = deck.slides[2].regions[0].blocks[0]
    expect(body.type === 'markdown' && body.source).toContain('### 1. First')
    expect(body.type === 'markdown' && body.source).toContain('### 2. Second')
    expect(body.type === 'markdown' && body.source).toContain(
      '[Report](https://example.test/report)'
    )
    expect(deck.slides[0].notes).toEqual(original.slides[0].notes)
    expect(presentationDeck(deck)).toEqual(deck)
    expect(parseDeck(serializeDeck(deck)).slides).toHaveLength(2)
  })
  it('ignores audience links and code examples, handles references, autolinks and URL parentheses', () => {
    const source =
      '# Example\n[Body](https://example.test/body)\n\n> [!notes]\n> `[Code](https://example.test/code)`\n>\n> ```text\n> [Example](https://example.test/example)\n> ```\n>\n> [Study](https://example.test/study_(sample))\n> [Reference][report]\n> <https://example.test/auto>\n>\n> [report]: https://example.test/reference'
    const deck = presentationDeck(parseDeck(source))
    expect(deck.slides[0].sources?.map((s) => s.target)).toEqual([
      'https://example.test/study_(sample)',
      'https://example.test/reference',
      'https://example.test/auto',
    ])
  })
  it('adds no final slide when notes have no links and escapes collected titles', () => {
    expect(presentationDeck(parseDeck('# Plain\n> [!notes]\n> Reminder')).slides).toHaveLength(1)
    const deck = presentationDeck(
      parseDeck(
        '# [Title](https://example.test/body)\n> [!notes]\n> [Source](https://example.test/source)'
      )
    )
    const body = deck.slides.at(-1)!.regions[0].blocks[0]
    expect(body.type === 'markdown' && body.source).not.toContain(
      '[Title](https://example.test/body)'
    )
  })
})
