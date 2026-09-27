/**
 * The markdown a gallery, a chart, a diagram or a map is written as, made from data.
 *
 * A script view shows these through `Markdown`, the same renderer a note and a chat reply go
 * through, so what they draw is exactly what the block would draw in a note. What is tested
 * here is only that the text is the block a person would have typed — and that nothing a
 * script passes in can close the block early and carry on as markdown of its own.
 */
import { describe, it, expect } from 'vitest'
import { parseYaml } from 'obsidian'
import { chartBlock, fence, galleryBlock, mapBlock, mermaidBlock } from '@/helpers/markdownBlocks'
import { parseGalleryHeader, parseImageLine } from '@/helpers/galleryUtils'
import { parseMapBlock } from '@/helpers/mapConfig'

describe('a fenced block', () => {
  it('is three backticks around the body', () => {
    expect(fence('mermaid', 'graph TD; A-->B')).toBe('```mermaid\ngraph TD; A-->B\n```')
  })

  it('is longer than any run of backticks in the body, so the body cannot close it', () => {
    const block = fence('mermaid', 'a\n```\nafter')
    expect(block.startsWith('````mermaid\n')).toBe(true)
    expect(block.endsWith('\n````')).toBe(true)
  })
})

describe('a gallery', () => {
  it('is the marker and one embed per line', () => {
    expect(galleryBlock(['a.png', 'Photos/b.jpg'])).toBe(
      '::abele-gallery::\n![[a.png]]\n![[Photos/b.jpg]]'
    )
  })

  it('takes a caption and an address on the web', () => {
    const text = galleryBlock([
      { src: 'a.png', caption: 'The first' },
      { src: 'https://example.com/b.jpg', caption: 'Remote' },
    ])
    const [, first, second] = text.split('\n')
    expect(parseImageLine(first)).toMatchObject({
      type: 'local',
      path: 'a.png',
      description: 'The first',
    })
    expect(parseImageLine(second)).toMatchObject({ type: 'remote' })
    expect(second).toBe('![Remote](https://example.com/b.jpg)')
  })

  it('writes the layout, height and background into the marker', () => {
    const header = galleryBlock(['a.png'], { layout: 'slider', height: 250, bg: false }).split(
      '\n'
    )[0]
    expect(parseGalleryHeader(header)).toEqual({ layout: 'slider', height: 250, bg: false })
  })

  it('keeps a name from breaking out of its embed', () => {
    const line = galleryBlock(['evil]]\n# heading|x.png']).split('\n').slice(1)
    expect(line).toHaveLength(1)
    expect(line[0].startsWith('![[')).toBe(true)
    expect(line[0].indexOf(']]')).toBe(line[0].length - 2)
  })
})

describe('a chart', () => {
  it('is an abele-chart block whose body reads back as the config', () => {
    const config = { type: 'bar', xLabels: ['a', 'b'], series: [{ name: 's', data: [1, 2] }] }
    const text = chartBlock(config)
    expect(text.startsWith('```abele-chart\n')).toBe(true)
    expect(parseYaml(text.split('\n').slice(1, -1).join('\n'))).toEqual(config)
  })

  it('keeps a formula as it was given', () => {
    const config = { x: [0, 5], series: [{ formula: 'x > 2 ? x^2 : 0' }] }
    const body = chartBlock(config).split('\n').slice(1, -1).join('\n')
    expect(parseYaml(body)).toEqual(config)
  })
})

describe('a diagram', () => {
  it('is a mermaid block of the source', () => {
    expect(mermaidBlock('graph TD\n  A-->B')).toBe('```mermaid\ngraph TD\n  A-->B\n```')
  })
})

describe('a map', () => {
  it('is an abele-map block the map reads as the same points', () => {
    const text = mapBlock({
      points: ['56.9496, 24.1052', { coordinates: '56.951, 24.194', label: 'Station' }],
    })
    expect(text.startsWith('```abele-map\n')).toBe(true)
    const parsed = parseMapBlock(text.split('\n').slice(1, -1).join('\n'))
    expect(parsed).toMatchObject({ points: [{ lat: 56.9496 }, { lat: 56.951, label: 'Station' }] })
  })
})
