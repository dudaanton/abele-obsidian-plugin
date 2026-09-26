/**
 * Drawing on a picture, without a screen (`drawing/imageInk.ts`): what kind of file the picture
 * comes out as, and the name a drawn copy takes beside it.
 */
import { describe, it, expect } from 'vitest'
import { drawnPath, formatOf } from '@/drawing/imageInk'

describe('a picture drawn on', () => {
  it('keeps its own kind where that can be written, and becomes a PNG where not', () => {
    expect(formatOf('PNG')).toEqual({ mime: 'image/png', ext: 'png', sameKind: true })
    expect(formatOf('jpeg')).toEqual({ mime: 'image/jpeg', ext: 'jpeg', sameKind: true })
    expect(formatOf('webp').sameKind).toBe(true)
    expect(formatOf('gif')).toEqual({ mime: 'image/png', ext: 'png', sameKind: false })
    expect(formatOf('bmp').sameKind).toBe(false)
  })

  it('is saved as a new picture beside the original under a name no file has', () => {
    const taken = new Set(['Pics/cat drawn.png', 'Pics/cat drawn 2.png'])
    expect(drawnPath('Pics/', 'cat', 'png', (p) => taken.has(p))).toBe('Pics/cat drawn 3.png')
    expect(drawnPath('', 'dog', 'jpg', () => false)).toBe('dog drawn.jpg')
  })
})
