import { expect, it } from 'vitest'
import { canvasEmbedOptions } from '@/canvas/embedFormat'
it('reads only supported canvas subpaths as exact one-based steps or opaque node ids', () => {
  expect(canvasEmbedOptions('sample.canvas#step=2|300')).toEqual({ step: 2 })
  expect(canvasEmbedOptions('sample.canvas#node=sample_node')).toEqual({ node: 'sample_node' })
  expect(canvasEmbedOptions('sample.canvas')).toEqual({})
  expect(() => canvasEmbedOptions('sample.canvas#step=0')).toThrow(/step/i)
  expect(() => canvasEmbedOptions('sample.canvas#step=2junk')).toThrow(/step/i)
  expect(() => canvasEmbedOptions('sample.canvas#node=')).toThrow(/node/i)
})
