import { describe, expect, it } from 'vitest'
import { rewriteDrawingReferences } from '@/canvas/excalidraw/references'

const source = 'Art/Sample sketch.excalidraw.md'
const target = 'Art/Sample sketch 2.canvas'
const resolve = (link: string) =>
  [
    'Sample sketch.excalidraw',
    'Sample sketch.excalidraw.md',
    source,
    '../Art/Sample sketch.excalidraw.md',
  ].includes(link)
    ? source
    : null
const rewrite = (text: string, kind: 'md' | 'canvas' = 'md') =>
  rewriteDrawingReferences(text, { source, target, kind, resolve })

describe('references to migrated drawings', () => {
  it('converts reference-style images to canvas picture embeds and keeps link definitions', () => {
    const result = rewrite(
      '![Preview|200][sample]\n\n[sample]: Sample%20sketch.excalidraw.md "Title"'
    )
    expect(result.text).toBe(
      '![[Art/Sample sketch 2.canvas|Preview|200]]\n\n[sample]: Art/Sample%20sketch%202.canvas "Title"'
    )
    expect(result.count).toBe(2)
  })
  it('does not rewrite a wiki-looking label inside another link', () => {
    const text = '[Label [[Sample sketch.excalidraw]]](Other.md)'
    expect(rewrite(text)).toEqual({ text, count: 0 })
  })
  it('preserves aliases, embed sizes, headings and multiple links on a line', () => {
    const result = rewrite(
      '[[Sample sketch.excalidraw|Words]] ![[Sample sketch.excalidraw.md#Part|300]] ![[Sample sketch.excalidraw|Preview|300x200]]'
    )
    expect(result).toEqual({
      count: 3,
      text: '[[Art/Sample sketch 2.canvas|Words]] ![[Art/Sample sketch 2.canvas#Part|300]] ![[Art/Sample sketch 2.canvas|Preview|300x200]]',
    })
  })
  it('rewrites markdown targets with encoding and titles; images become native canvas picture embeds', () => {
    const result = rewrite(
      '[Words](../Art/Sample%20sketch.excalidraw.md#Part "Title") ![Preview|300](<Sample sketch.excalidraw.md>)'
    )
    expect(result).toEqual({
      count: 2,
      text: '[Words](Art/Sample%20sketch%202.canvas#Part "Title") ![[Art/Sample sketch 2.canvas|Preview|300]]',
    })
  })
  it('leaves code blocks, inline code, escaped links, unrelated links and ordinary text alone', () => {
    const text =
      'Sample sketch.excalidraw.md\n`[[Sample sketch.excalidraw]]`\n```md\n![[Sample sketch.excalidraw]]\n```\n    [[Sample sketch.excalidraw]]\n\\[[Sample sketch.excalidraw]] [[Other.excalidraw]]'
    expect(rewrite(text)).toEqual({ count: 0, text })
  })
  it('changes only file nodes in a canvas, retaining JSON formatting and other fields', () => {
    const text =
      '{ "nodes": [{"id":"a", "type":"file", "file":"Art/Sample sketch.excalidraw.md", "subpath":"#Part"}, {"id":"b","type":"text","text":"[[Sample sketch.excalidraw]]"}], "other":{"file":"Art/Sample sketch.excalidraw.md"} }'
    expect(rewrite(text, 'canvas')).toEqual({
      count: 1,
      text: text.replace(
        '"file":"Art/Sample sketch.excalidraw.md"',
        '"file":"Art/Sample sketch 2.canvas"'
      ),
    })
  })
})
