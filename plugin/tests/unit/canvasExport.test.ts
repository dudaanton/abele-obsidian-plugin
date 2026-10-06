import { describe, expect, it } from 'vitest'
import {
  planCanvasExport,
  imagePagePdf,
  imageDimensions,
  EXPORT_LIMITS,
} from '@/canvas/core/export'
import { serializeCanvas, type CanvasGraph } from '@/canvas/core/model'

const graph: CanvasGraph = {
  nodes: [
    { id: 'near', type: 'text', text: 'Near — 日本語', x: 0, y: 0, width: 200, height: 100 },
    { id: 'far', type: 'text', text: 'Far', x: 2400, y: -600, width: 300, height: 180 },
  ],
  edges: [],
  abele: { steps: [{ id: 'first', reveal: ['near'], focus: 'near', say: 'Only near' }] },
}
describe('whole canvas export planning and raster PDF', () => {
  it('captures the complete graph without a camera or walkthrough crop and does not mutate source', () => {
    const before = serializeCanvas(graph)
    const plan = planCanvasExport(graph, 4096)
    expect(plan.region.x).toBeLessThanOrEqual(0)
    expect(plan.region.y).toBeLessThanOrEqual(-600)
    expect(plan.region.x + plan.region.width).toBeGreaterThanOrEqual(2700)
    expect(plan.graph.nodes.map((n) => n.id)).toEqual(['near', 'far'])
    graph.nodes[0].text = 'New revision'
    expect(plan.graph.nodes[0].text).toBe('Near — 日本語')
    graph.nodes[0].text = 'Near — 日本語'
    expect(serializeCanvas(graph)).toBe(before)
  })
  it('bounds raster allocations and rejects unsafe sizes and nonfinite bounds', () => {
    const large = { nodes: [{ ...graph.nodes[0], width: 1e8, height: 1e8 }], edges: [] }
    const plan = planCanvasExport(large)
    expect(plan.width * plan.height).toBeLessThanOrEqual(EXPORT_LIMITS.rasterPixels)
    expect(plan.width).toBe(4096)
    expect(() => planCanvasExport(graph, 8192)).toThrow(/maxSide/)
    expect(() =>
      planCanvasExport({ nodes: [{ ...graph.nodes[0], x: Infinity }], edges: [] })
    ).toThrow()
    expect(planCanvasExport({ nodes: [], edges: [] }).width).toBeGreaterThan(0)
  })
  it('writes a valid one-page PDF with byte-accurate stream lengths and xref offsets', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0x80, 0, 0xff, 0xd9])
    const pdf = imagePagePdf(jpeg, 800, 600)
    const text = new TextDecoder('latin1').decode(pdf)
    expect(text).toMatch(/^%PDF-1\.4/)
    expect(text).toContain('/MediaBox [0 0 600 450]')
    expect(text).toContain('/Width 800 /Height 600')
    expect(text).toContain('/Filter /DCTDecode /Length 6')
    expect(text).toContain('/Count 1')
    const xref = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(new TextDecoder().decode(pdf.slice(xref, xref + 4))).toBe('xref')
    const offsets = text
      .slice(xref)
      .split('\n')
      .slice(3, 8)
      .map((line) => Number(line.slice(0, 10)))
    offsets.forEach((offset, i) =>
      expect(new TextDecoder().decode(pdf.slice(offset, offset + 7))).toBe(`${i + 1} 0 obj`)
    )
    expect(text).not.toMatch(/\/JavaScript|\/OpenAction|\/Launch/)
    expect(() => imagePagePdf(jpeg, 0, 600)).toThrow()
  })
  it('checks image dimensions before allowing a compressed large image to decode', () => {
    const png = new Uint8Array(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.set([73, 72, 68, 82], 12)
    const view = new DataView(png.buffer)
    view.setUint32(16, 100000)
    view.setUint32(20, 100000)
    expect(imageDimensions(png, 'png')).toEqual({ width: 100000, height: 100000 })
    expect(imageDimensions(new Uint8Array(4), 'png')).toBeNull()
  })
})
