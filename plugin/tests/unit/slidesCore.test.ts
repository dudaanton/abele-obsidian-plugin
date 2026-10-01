import { describe, expect, it } from 'vitest'
import { parseDeck, serializeDeck } from '@/slides/core/markdown'
import { navigate, slideForKey, slideForGesture, fitSlide } from '@/slides/core/navigation'

const sample = `---
type: presentation
aspect: '16:9'
theme: '[[sample-theme.css]]'
custom: keep
---
::slide{layout=title class="sample-title"}::
# Sample deck

***

---
::slide{layout=split bg="[[sample-image.png]]" dim=0.4 fit=contain autoplay steps}::
## Two sides
::left::
- First
::right::
![[sample-video.mp4]]

> [!notes]
> Say this privately.
>
> - A reminder

---
::slide{layout=grid}::
## Grid
::cell::
One
::cell::
Two

\`\`\`css
body { --sample: 1; }
h1 { color: var(--text-accent); }
\`\`\`
`

const content = (deck: ReturnType<typeof parseDeck>, index: number) =>
  deck.slides[index].regions.flatMap((r) => r.blocks.map((b) => b.source)).join('\n')

describe('presentation markdown codec', () => {
  it('reads deck metadata, seven fixed layouts and per-slide settings into a portable model', () => {
    const deck = parseDeck(sample)
    expect(deck.settings.aspect).toBe('16:9')
    expect(deck.settings.theme).toBe('[[sample-theme.css]]')
    expect(deck.settings.properties.custom).toBe('keep')
    expect(deck.slides).toHaveLength(3)
    expect(deck.slides[0].settings.layout).toBe('title')
    expect(deck.slides[1].settings).toMatchObject({
      layout: 'split',
      bg: '[[sample-image.png]]',
      dim: 0.4,
      fit: 'contain',
      autoplay: true,
    })
    expect(deck.slides[1].settings.attributes.steps).toBe(true)
    expect(deck.slides[1].regions.map((r) => r.name)).toEqual(['body', 'left', 'right'])
    expect(deck.slides[2].regions.map((r) => r.name)).toEqual(['body', 'cell', 'cell'])
    expect(content(deck, 0)).toContain('***')
    expect(content(deck, 1)).not.toContain('::left::')
    expect(content(deck, 1)).not.toContain('Say this privately')
    expect(deck.slides[1].notes.map((n) => n.source).join('\n')).toBe(
      'Say this privately.\n\n- A reminder'
    )
    expect(deck.css).toContain('body { --sample: 1; }')
    expect(content(deck, 2)).not.toContain('```css')
    for (const layout of ['title', 'section', 'content', 'split', 'grid', 'image', 'quote']) {
      expect(parseDeck(`::slide{layout=${layout}}::\n# Example`).slides[0].settings.layout).toBe(
        layout
      )
    }
  })

  it('round trips the model without losing speaker notes, media, styles or unknown attributes', () => {
    const original = parseDeck(sample)
    const restored = parseDeck(serializeDeck(original))
    const semantic = (deck: typeof original) => ({
      settings: deck.settings,
      css: deck.css,
      slides: deck.slides.map(({ settings, regions, notes, title }) => ({
        settings,
        regions,
        notes,
        title,
      })),
    })
    expect(semantic(restored)).toEqual(semantic(original))
  })

  it('ignores frontmatter fences, fenced code, block quotes, indented code and HTML code blocks when splitting', () => {
    const source = `---\ntype: presentation\n---\n# One\n\n\`\`\`markdown\n---\n::left::\n> [!notes]\n> not a private note\n\`\`\`\n\n~~~~\n---\n~~~\n---\n~~~~\n\n> ---\n\n    ---\n\n<pre>\n---\n</pre>\n\n---\n# Two`
    const deck = parseDeck(source)
    expect(deck.slides).toHaveLength(2)
    expect(deck.slides[0].notes).toEqual([])
    expect(deck.slides[0].regions).toHaveLength(1)
    expect(content(deck, 0)).toContain('> not a private note')
    expect(deck.slides[1].title).toBe('Two')
  })

  it('keeps thematic breaks and fences inside list items without swallowing later slide boundaries', () => {
    for (const list of [
      '- A sample item\n\n  ---\n\n  More item text',
      '- ```markdown\n  ---\n  ::left::\n  ```\n\n  After the example',
      '1. Numbered example\n\n   ~~~~md\n   ---\n   ~~~~',
      '- Outer\n  - ```md\n    ---\n    ```',
    ]) {
      const deck = parseDeck(`# Lists\n\n${list}\n\n---\n# Next slide`)
      expect(deck.slides, list).toHaveLength(2)
      expect(content(deck, 0), list).toContain(list)
      expect(deck.slides[0].regions).toHaveLength(1)
      expect(deck.slides[1].title).toBe('Next slide')
    }
  })

  it('keeps empty slides and defaults invalid options safely', () => {
    const deck = parseDeck(
      '---\ntype: presentation\naspect: nonsense\n---\n---\n::slide{layout=missing dim=5 fit=unknown}::\n---'
    )
    expect(deck.slides).toHaveLength(3)
    expect(deck.settings.aspect).toBe('16:9')
    expect(deck.slides[1].settings).toMatchObject({ layout: 'content', dim: 1, fit: 'cover' })
    expect(parseDeck('').slides).toHaveLength(1)
  })

  it('extracts multiple folded notes callouts but leaves other callouts and code alone', () => {
    const deck = parseDeck(
      '# Public\n\n> [!notes]- Private heading\n> Secret one\n\n> [!tip]\n> Visible\n\n> [!notes]+\n> Secret two'
    )
    expect(deck.slides[0].notes.map((b) => b.source)).toEqual(['Secret one', 'Secret two'])
    expect(content(deck, 0)).toContain('Visible')
    expect(content(deck, 0)).not.toContain('Private heading')
  })

  it('extracts speaker notes nested in public quotes and list items without exposing their text', () => {
    const deck = parseDeck(
      '# Nested notes\n\n> [!tip]\n> Visible advice\n>\n> > [!notes]+\n> > Nested reminder\n> >\n> > - Private checklist\n>\n> More visible advice\n\n- Public item\n\n  > [!notes]\n  > List reminder\n\n- Next public item\n\n> [!notes]\n> A final reminder\nPrivate lazy continuation\n\nPublic ending'
    )
    expect(deck.slides[0].notes.map((n) => n.source)).toEqual([
      'Nested reminder\n\n- Private checklist',
      'List reminder',
      'A final reminder\nPrivate lazy continuation',
    ])
    const publicText = content(deck, 0)
    for (const secret of [
      'Nested reminder',
      'Private checklist',
      'List reminder',
      'A final reminder',
      'Private lazy continuation',
    ])
      expect(publicText).not.toContain(secret)
    for (const visible of [
      'Visible advice',
      'More visible advice',
      'Public item',
      'Next public item',
      'Public ending',
    ])
      expect(publicText).toContain(visible)
    const restored = parseDeck(serializeDeck(deck))
    expect(restored.slides[0].notes).toEqual(deck.slides[0].notes)
    expect(content(restored, 0)).not.toContain('Nested reminder')
  })

  it('leaves notes syntax inside quoted and list-contained code examples as code', () => {
    const source =
      '> ```md\n> > [!notes]\n> > Quoted code example\n> ```\n\n- ```md\n  > [!notes]\n  > List code example\n  ```\n\n>     [!notes]\n>     Indented example'
    const deck = parseDeck(source)
    expect(deck.slides[0].notes).toEqual([])
    expect(content(deck, 0)).toBe(source)
  })

  it('serializes edited settings rather than stale directive values', () => {
    const deck = parseDeck(
      '::slide{layout=image bg="[[sample-image.png]]" dim=0.5 fit=contain class=sample autoplay steps}::\n# Sample'
    )
    Object.assign(deck.slides[0].settings, {
      layout: 'content',
      bg: '',
      dim: 0,
      fit: 'cover',
      className: '',
      autoplay: false,
    })
    const restored = parseDeck(serializeDeck(deck))
    expect(restored.slides[0].settings).toMatchObject({
      layout: 'content',
      bg: '',
      dim: 0,
      fit: 'cover',
      className: '',
      autoplay: false,
    })
    expect(restored.slides[0].settings.attributes.steps).toBe(true)
  })

  it('preserves leading code indentation in each region and speaker notes through a round trip', () => {
    const deck = parseDeck(
      '    # code, not a heading\n\n---\n::slide{layout=split}::\n::left::\n    const sample = 1\n::right::\n\tconst other = 2\n\n> [!notes]\n>     private code'
    )
    expect(content(deck, 0)).toBe('    # code, not a heading')
    expect(deck.slides[1].regions[1].blocks[0].source).toBe('    const sample = 1')
    expect(deck.slides[1].regions[2].blocks[0].source).toBe('\tconst other = 2')
    expect(deck.slides[1].notes[0].source).toBe('    private code')
    const restored = parseDeck(serializeDeck(deck))
    expect(content(restored, 0)).toBe(content(deck, 0))
    expect(restored.slides[1].regions).toEqual(deck.slides[1].regions)
    expect(restored.slides[1].notes).toEqual(deck.slides[1].notes)
  })

  it('removes a cleared theme instead of reviving stale frontmatter', () => {
    const deck = parseDeck(
      '---\ntype: presentation\ntheme: "[[sample-old-theme.css]]"\ncustom: retain\n---\n# Example'
    )
    deck.settings.theme = ''
    const restored = parseDeck(serializeDeck(deck))
    expect(restored.settings.theme).toBe('')
    expect(restored.settings.properties.theme).toBeUndefined()
    expect(restored.settings.properties.custom).toBe('retain')
  })

  it('does not promote a mid-slide marker into settings', () => {
    const deck = parseDeck('# Text\n\n::slide{layout=quote}::')
    expect(deck.slides[0].settings.layout).toBe('content')
    expect(content(deck, 0)).toContain('::slide')
  })
})

describe('portable slide navigation and scaling', () => {
  it('clamps rather than wrapping and handles an empty deck', () => {
    expect(navigate(0, 'previous', 4)).toBe(0)
    expect(navigate(3, 'next', 4)).toBe(3)
    expect(navigate(1, 'last', 4)).toBe(3)
    expect(navigate(2, 'first', 4)).toBe(0)
    expect(navigate(2, 100, 4)).toBe(3)
    expect(navigate(0, 'last', 0)).toBe(0)
  })
  it('maps keyboard commands and leaves typing or modified shortcuts alone', () => {
    expect(slideForKey('ArrowRight')).toBe('next')
    expect(slideForKey('PageUp')).toBe('previous')
    expect(slideForKey(' ')).toBe('next')
    expect(slideForKey('Home')).toBe('first')
    expect(slideForKey('End')).toBe('last')
    expect(slideForKey('a')).toBeNull()
  })
  it('pages with horizontal swipes and outer-third taps, not vertical or ambiguous gestures', () => {
    expect(slideForGesture({ x: 200, y: 100 }, { x: 100, y: 110 }, 390)).toBe('next')
    expect(slideForGesture({ x: 100, y: 100 }, { x: 180, y: 110 }, 390)).toBe('previous')
    expect(slideForGesture({ x: 20, y: 100 }, { x: 20, y: 100 }, 390)).toBe('previous')
    expect(slideForGesture({ x: 370, y: 100 }, { x: 370, y: 100 }, 390)).toBe('next')
    expect(slideForGesture({ x: 200, y: 100 }, { x: 200, y: 200 }, 390)).toBeNull()
    expect(slideForGesture({ x: 200, y: 100 }, { x: 200, y: 100 }, 390)).toBeNull()
  })
  it('fits a fixed logical canvas and centres it on portrait and landscape screens', () => {
    expect(fitSlide(390, 700, '16:9')).toEqual({
      width: 1280,
      height: 720,
      scale: 390 / 1280,
      x: 0,
      y: (700 - (390 * 9) / 16) / 2,
    })
    expect(fitSlide(1280, 720, '16:9')).toMatchObject({ scale: 1, x: 0, y: 0 })
    expect(fitSlide(0, 0, '16:9').scale).toBe(0)
    expect(fitSlide(1000, 1000, '4:3')).toMatchObject({ width: 960, height: 720 })
    expect(fitSlide(390, 844, '9:16')).toMatchObject({ width: 720, height: 1280 })
  })
})
