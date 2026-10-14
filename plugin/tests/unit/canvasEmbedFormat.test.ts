import { expect, it } from 'vitest'
import { canvasEmbed, canvasEmbedOptions } from '@/canvas/embedFormat'
it('reads only supported canvas subpaths as exact one-based steps or opaque node ids', () => {
  expect(canvasEmbedOptions('sample.canvas#step=2|300')).toEqual({ step: 2 })
  expect(canvasEmbedOptions('sample.canvas#node=sample_node')).toEqual({ node: 'sample_node' })
  expect(canvasEmbedOptions('sample.canvas')).toEqual({})
  expect(() => canvasEmbedOptions('sample.canvas#step=0')).toThrow(/step/i)
  expect(() => canvasEmbedOptions('sample.canvas#step=2junk')).toThrow(/step/i)
  expect(() => canvasEmbedOptions('sample.canvas#node=')).toThrow(/node/i)
})
it('reads a part of the canvas as x,y,width,height in its own units, and writes it back', () => {
  expect(canvasEmbedOptions('sample.canvas#part=-40,20,600,300')).toEqual({
    region: { x: -40, y: 20, width: 600, height: 300 },
  })
  expect(canvasEmbedOptions('sample.canvas#part=0,0,10.5,8|400')).toEqual({
    region: { x: 0, y: 0, width: 10.5, height: 8 },
  })
  expect(() => canvasEmbedOptions('sample.canvas#part=0,0,0,8')).toThrow(/part/i)
  expect(() => canvasEmbedOptions('sample.canvas#part=1,2,3')).toThrow(/part/i)
  expect(
    canvasEmbed('Plans/sample.canvas', { region: { x: -40.4, y: 20, width: 600, height: 300.6 } })
  ).toBe('![[Plans/sample.canvas#part=-40,20,600,301]]')
  expect(canvasEmbed('Plans/sample.canvas', { node: 'frame_1' })).toBe(
    '![[Plans/sample.canvas#node=frame_1]]'
  )
  expect(canvasEmbed('Plans/sample.canvas', {})).toBe('![[Plans/sample.canvas]]')
})
