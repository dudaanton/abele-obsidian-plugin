/**
 * Which lines make up a gallery.
 *
 * The editor and the reading-mode post-processor both draw from this, so a note must read
 * as the same galleries in both: same header, same pictures, same end of the block.
 */
import { describe, it, expect } from 'vitest'
import { findGalleryBlocks } from '@/helpers/galleryUtils'

describe('findGalleryBlocks', () => {
  it('takes the header and the embeds under it, blank lines included', () => {
    const blocks = findGalleryBlocks([
      'Intro',
      '::abele-gallery{height=320}::',
      '![[a.jpg]]',
      '',
      '![[b.jpg|the second]]',
      'Outro',
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ headerLine: 1, lastLine: 4, height: 320, layout: 'grid' })
    expect(blocks[0].images.map((i) => i.path)).toEqual(['a.jpg', 'b.jpg'])
    expect(blocks[0].images[1].description).toBe('the second')
  })

  it('ends a block at the first line that is not an embed', () => {
    const [block] = findGalleryBlocks(['::abele-gallery::', '![[a.jpg]]', 'text', '![[b.jpg]]'])

    expect(block.lastLine).toBe(1)
    expect(block.images).toHaveLength(1)
  })

  it('finds every block and a header with nothing under it', () => {
    const blocks = findGalleryBlocks([
      '::abele-gallery::',
      '',
      '::abele-gallery{layout=slider}::',
      '![](https://x/y.png)',
    ])

    expect(blocks.map((b) => [b.headerLine, b.lastLine])).toEqual([
      [0, 0],
      [2, 3],
    ])
    expect(blocks[0].images).toEqual([])
    expect(blocks[1].layout).toBe('slider')
    expect(blocks[1].images[0].type).toBe('remote')
  })
})
