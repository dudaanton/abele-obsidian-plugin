import { describe, expect, it } from 'vitest'
import { insertSize, linkAsk, pictureSize } from '@/word/pageDialogs'
import type { WordPageModel } from '@/word/pageModel'
import { samplePng } from '../fixtures/docx/samplePng'

const model: WordPageModel = {
  styles: [],
  blocks: [
    {
      kind: 'paragraph',
      number: 1,
      runs: [
        { text: 'Sample ' },
        { text: 'linked words', link: 'https://example.com/a' },
        { text: ' and the rest of a fairly long invented sentence for cutting' },
      ],
    },
  ],
} as unknown as WordPageModel

describe('the link window', () => {
  it('names the chosen words and the address already on them', () => {
    expect(linkAsk(model, { operation: 'link', paragraph: 1, from: 7, to: 19 })).toEqual({
      words: 'linked words',
      current: 'https://example.com/a',
    })
  })

  it('names no words for the whole paragraph, and cuts long ones short', () => {
    expect(linkAsk(model, { operation: 'link', paragraph: 1 })?.words).toBe('')
    const long = linkAsk(model, { operation: 'link', paragraph: 1, from: 19, to: 75 })
    expect(long?.words).toHaveLength(41)
    expect(long?.words.endsWith('…')).toBe(true)
    expect(long?.current).toBeUndefined()
  })
})

describe('a picture from the vault', () => {
  const bytes = (...parts: (string | number[])[]) =>
    Uint8Array.from(
      parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p))
    )

  it('reads its size from the header of each kind Word takes', () => {
    expect(pictureSize(samplePng())).toEqual({ width: 16, height: 16 })
    expect(pictureSize(bytes('GIF89a', [0x40, 0x01, 0xf0, 0x00]))).toEqual({
      width: 320,
      height: 240,
    })
    // A start of image, an APP0 segment to step over, then the frame: height 600, width 800.
    expect(
      pictureSize(
        bytes(
          [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0],
          [0xff, 0xc0, 0x00, 0x11, 0x08],
          [2, 88, 3, 32],
          [3, 0, 0]
        )
      )
    ).toEqual({ width: 800, height: 600 })
    expect(
      pictureSize(
        bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [0, 0, 0, 0, 0, 0, 0, 0], [99, 0, 0], [49, 0, 0])
      )
    ).toEqual({ width: 100, height: 50 })
    expect(pictureSize(bytes('not a picture at all'))).toBeUndefined()
  })

  it('comes in at its own size, made smaller in proportion to fit the page', () => {
    expect(insertSize({ width: 16, height: 16 })).toEqual({ width: 16, height: 16 })
    expect(insertSize({ width: 1248, height: 800 })).toEqual({ width: 624, height: 400 })
    expect(insertSize(undefined)).toEqual({ width: 320, height: 240 })
  })
})
