/**
 * A drawing for the agent and as a picture: `look_at_drawing` (`ai/tools/DrawingTool.ts`), the
 * question a drawing's tab begins in a chat (`drawing/askAgent.ts`), and how large a part is
 * painted (`drawing/rasterize.ts`).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createLookAtDrawingTool } from '@/ai/tools/DrawingTool'
import { drawingQuestion } from '@/drawing/askAgent'
import { rasterScale, withMargin } from '@/drawing/rasterize'
import { drawingSvg } from '@/drawing/drawingFile'
import { CORE_TOOLS } from '@/ai/types'
import type { DrawingItem } from '@/drawing/items'
import { useVault } from '../helpers/testEnv'

const items: DrawingItem[] = [
  {
    id: 'a',
    type: 'stroke',
    tool: 'pen',
    color: 'black',
    size: 2,
    points: [0, 0, 0.5, 100, 50, 0.5],
  },
  { id: 't', type: 'text', x: 400, y: 400, text: 'Buy milk\nand bread', size: 20, color: 'red' },
]

const run = (params: Record<string, unknown>) =>
  createLookAtDrawingTool().execute('1', params) as Promise<{
    content: { text: string }[]
    injectMessages: { content: { type: string; image_url?: { url: string } }[] }[]
  }>

beforeEach(() => {
  const app = useVault([
    { path: 'D/Sketch.svg', raw: drawingSvg({ items }) },
    { path: 'D/plain.svg', raw: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  ])
  // No drawing is open in a tab.
  Object.assign(app, { workspace: { getLeavesOfType: () => [] } })
})

describe('looking at a drawing', () => {
  it('shows all of it as a picture, with its bounds and the text typed on it', async () => {
    const r = await run({ path: 'D/Sketch.svg' })
    expect(r.content[0].text).toMatch(
      /whole of it is -?\d+ -?\d+ \d+ \d+; shown: all of it, 2 item/
    )
    expect(r.content[0].text).toContain('“Buy milk / and bread”')
    const image = r.injectMessages[0].content.find((p) => p.type === 'image_url')
    expect(image?.image_url?.url.startsWith('data:')).toBe(true)
  })

  it('shows a part, and only what is in it', async () => {
    const r = await run({ path: 'D/Sketch.svg', area: '0 0 150 80' })
    expect(r.content[0].text).toContain('shown: 0 0 150 80, 1 item(s)')
    expect(r.content[0].text).not.toContain('Buy milk')
  })

  it('says what is wrong: no such file, not a drawing, a part that is not one, nothing picked', async () => {
    await expect(run({ path: 'D/none.svg' })).rejects.toThrow('File not found')
    await expect(run({ path: 'D/plain.svg' })).rejects.toThrow('Not a drawing')
    await expect(run({ path: 'D/Sketch.svg', area: 'left side' })).rejects.toThrow('four numbers')
    await expect(run({ path: 'D/Sketch.svg', picked: true })).rejects.toThrow('Nothing is picked')
  })

  it('is one of the tools every agent has, like reading a picture', () => {
    expect(CORE_TOOLS.has('look_at_drawing')).toBe(true)
  })
})

describe('asking about a drawing', () => {
  it('begins the question with the drawing, and the part picked', () => {
    expect(drawingQuestion('[[D/Sketch.svg]]', null, 'ask')).toBe('Look at [[D/Sketch.svg]]: ')
    expect(drawingQuestion('[[D/Sketch.svg]]', { x: 1, y: 2, w: 30, h: 40 }, 'transcribe')).toBe(
      'Transcribe the handwriting in the part of [[D/Sketch.svg]] at 1 2 30 40 (picked) as text, keeping its lines and lists.'
    )
  })
})

describe('a drawing as a picture', () => {
  it('enlarges a small part so writing in it reads, and holds a large one to a size', () => {
    expect(rasterScale({ x: 0, y: 0, w: 100, h: 50 })).toBe(4)
    expect(rasterScale({ x: 0, y: 0, w: 4096, h: 100 })).toBe(0.5)
    expect(withMargin({ x: 10, y: 10, w: 10, h: 10 }, 5)).toEqual({ x: 5, y: 5, w: 20, h: 20 })
  })
})
