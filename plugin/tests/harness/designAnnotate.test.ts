import { afterEach, expect, it, vi } from 'vitest'
import { annotateDesign } from '../helpers/designAnnotate'
import type { DesignSnapshot, Violation } from '../helpers/designLint'
afterEach(() => vi.restoreAllMocks())
it('maps screenshots to CSS pixels and emits a numbered 3x crop for every violation', async () => {
  vi.spyOn(Image.prototype, 'decode').mockResolvedValue(undefined)
  const drawImage = vi.fn()
  const context = {
    drawImage,
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 100 }),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    scale: vi.fn(),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  const dimensions: number[][] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    dimensions.push([this.width, this.height])
    return 'data:image/png;base64,c2FtcGxl'
  })
  const snapshot: DesignSnapshot = {
    selector: '#surface',
    viewport: { width: 800, height: 600 },
    mobile: false,
    scale: [0, 4],
    elements: [],
  }
  const violations: Violation[] = [
    {
      rule: 'line-alignment',
      message: 'Example',
      elements: ['a'],
      boxes: [{ x: 50, y: 50, width: 20, height: 20 }],
    },
  ]
  const emit = vi.fn()
  await annotateDesign(snapshot, violations, 'data:image/png;base64,c2FtcGxl', emit)
  expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 800, 600])
  expect(emit.mock.calls.map((c) => c[0])).toEqual([
    'annotated.png',
    'violation-001-line-alignment-3x.png',
  ])
  expect(dimensions).toEqual([
    [800, 600],
    [180, 192],
  ])
  expect(context.fillText).toHaveBeenCalledTimes(2)
})
