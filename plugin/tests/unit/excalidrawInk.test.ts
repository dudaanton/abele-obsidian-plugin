import { describe, expect, it } from 'vitest'
import { convertExcalidraw } from '@/canvas/excalidraw/convert'
import { parseExcalidraw } from '@/canvas/excalidraw/source'
import { inkOf } from '@/canvas/core/ink'
import { eraseInk, inkPath } from '@/canvas/core/ink'
import { createCanvas, Path2D } from '@napi-rs/canvas'
import { parseCanvas } from '@/canvas/core/model'
import { pencilElements, pencilScene, referencePath } from '../helpers/excalidrawInkScene'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { handwriting } from '../helpers/handwriting'
import { penWidth, strokeCenterline, strokePath } from '@/ink/stroke'

describe('migrated freehand geometry', () => {
  it('simulates lighter pressure on fast segments instead of a constant', () => {
    const scene = parseExcalidraw(
      JSON.stringify({
        elements: [
          {
            id: 'sample-speed',
            type: 'freedraw',
            x: 0,
            y: 0,
            width: 100,
            height: 1,
            strokeWidth: 2,
            simulatePressure: true,
            points: [
              [0, 0],
              [0.2, 0],
              [0.4, 0],
              [20, 0],
              [40, 0],
              [60, 0],
            ],
          },
        ],
      }),
      'sample.excalidraw'
    )
    const stroke = inkOf(
      convertExcalidraw(scene, { source: 'sample.excalidraw', resolve: () => null }).graph
    )[0]
    expect(stroke.points[17]).toBeLessThan(stroke.points[8])
  })
  for (const width of [1, 2, 4]) {
    for (const simulated of [false, true]) {
      it(`keeps dense samples and width ${width}, simulated=${simulated}`, () => {
        const points = Array.from({ length: 240 }, (_, i) => [i * 0.037, Math.sin(i / 80) * 3.013])
        const pressures = points.map((_, i) => 0.2 + (i / 239) * 0.6)
        const scene = parseExcalidraw(
          JSON.stringify({
            type: 'excalidraw',
            elements: [
              {
                id: 'sample-curve',
                type: 'freedraw',
                x: 10.013,
                y: 20.027,
                width: 10,
                height: 4,
                points,
                pressures,
                strokeWidth: width,
                simulatePressure: simulated,
              },
            ],
          }),
          'sample.excalidraw'
        )
        const stroke = inkOf(
          convertExcalidraw(scene, { source: 'sample.excalidraw', resolve: () => null }).graph
        )[0]
        expect(stroke.size).toBe(width * 4.25 * Math.SQRT2)
        points.forEach(([x, y], i) => {
          expect(stroke.points[i * 3]).toBe(x + 10.013)
          expect(stroke.points[i * 3 + 1]).toBe(y + 20.027)
          if (!simulated) expect(stroke.points[i * 3 + 2]).toBe(pressures[i])
        })
      })
    }
  }
})

describe('migrated pencil rendering against the source outline', () => {
  it('cuts imported ink without streamlining the fragments a second time or changing nib width', () => {
    const el = {
      ...pencilElements[0],
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [20, 0],
        [40, 0],
        [60, 0],
        [80, 0],
        [100, 0],
      ],
      pressures: Array(6).fill(0.2),
    }
    const graph = convertExcalidraw(
      parseExcalidraw(JSON.stringify({ elements: [el] }), 'sample.excalidraw'),
      {
        source: 'sample.excalidraw',
        resolve: () => null,
      }
    ).graph
    const stroke = inkOf(graph)[0]
    const expectedWidth = 2 * 4.25 * Math.sin(((0.2 + 0.6 * 0.2) * Math.PI) / 2)
    const centreline = strokeCenterline({ ...stroke, color: 'black' })
    expect(penWidth(stroke.size, centreline[2])).toBeCloseTo(expectedWidth, 5)
    const fragments = eraseInk({ stroke }, 50, 0, 5, () => 'fragment')
    expect(fragments).toHaveLength(2)
    for (const fragment of fragments) {
      expect(fragment.freedraw).toBeUndefined()
      expect(fragment.linear).toBe(true)
      expect(penWidth(fragment.size, fragment.points[2])).toBeCloseTo(expectedWidth, 5)
    }
  })
  it('keeps native hand-sampled ink geometry unchanged', () => {
    expect(createHash('sha256').update(strokePath(handwriting)).digest('hex')).toBe(
      'e426aa57dbce3178008483c3d4d94530f5a1c3060ef7359b7c96cb54bba44244'
    )
  })
  for (const el of pencilElements) {
    it(`matches source thickness and smooth coverage for ${el.id}`, () => {
      const graph = convertExcalidraw(parseExcalidraw(pencilScene, 'sample.excalidraw'), {
        source: 'sample.excalidraw',
        resolve: () => null,
      }).graph
      const stroke = inkOf(parseCanvas(JSON.parse(JSON.stringify(graph)))).find(
        (s) => s.id === el.id
      )!
      const raster = (path: string) => {
        const canvas = createCanvas(700, 800)
        const ctx = canvas.getContext('2d')
        ctx.scale(2, 2)
        ctx.fill(new Path2D(path))
        return ctx.getImageData(0, 0, 700, 800).data
      }
      const actual = raster(inkPath(stroke)),
        expected = raster(referencePath(el))
      let area = 0,
        reference = 0,
        difference = 0
      for (let i = 3; i < actual.length; i += 4) {
        area += actual[i]
        reference += expected[i]
        difference += Math.abs(actual[i] - expected[i])
      }
      expect(area / reference, 'mean rendered thickness').toBeGreaterThanOrEqual(0.85)
      expect(area / reference, 'mean rendered thickness').toBeLessThanOrEqual(1.15)
      expect(difference / reference, 'outline coverage, including staircase edges').toBeLessThan(
        0.05
      )
    })
  }
})

const acceptanceFile = process.env.ABELE_INK_ACCEPTANCE_FILE
it.skipIf(!acceptanceFile)('renders a private acceptance scene without adding a fixture', () => {
  const scene = parseExcalidraw(readFileSync(acceptanceFile!, 'utf8'), 'sample.excalidraw.md')
  const graph = convertExcalidraw(scene, {
    source: 'sample.excalidraw.md',
    resolve: () => null,
  }).graph
  const strokes = inkOf(parseCanvas(JSON.parse(JSON.stringify(graph))))
  const xs = strokes.flatMap((s) => s.points.filter((_, i) => i % 3 === 0))
  const ys = strokes.flatMap((s) => s.points.filter((_, i) => i % 3 === 1))
  const left = Math.min(...xs) - 10,
    top = Math.min(...ys) - 10
  const scale = 1600 / (Math.max(...xs) - left + 10)
  const raster = (paths: string[]) => {
    const canvas = createCanvas(1600, Math.ceil((Math.max(...ys) - top + 10) * scale))
    const ctx = canvas.getContext('2d')
    ctx.scale(scale, scale)
    ctx.translate(-left, -top)
    for (const path of paths) ctx.fill(new Path2D(path))
    return canvas
  }
  const actual = raster(strokes.map(inkPath))
  const expected = raster(
    scene.elements.map((el) => referencePath(el as unknown as (typeof pencilElements)[number]))
  )
  const a = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data
  const b = expected.getContext('2d').getImageData(0, 0, expected.width, expected.height).data
  let area = 0,
    reference = 0,
    difference = 0
  for (let i = 3; i < a.length; i += 4) {
    area += a[i]
    reference += b[i]
    difference += Math.abs(a[i] - b[i])
  }
  console.log('Acceptance outline ratios', {
    thickness: area / reference,
    difference: difference / reference,
  })
  if (process.env.ABELE_INK_ACCEPTANCE_SHOTS) {
    const prefix = process.env.ABELE_INK_ACCEPTANCE_SHOTS
    for (const canvas of [actual, expected]) {
      const ctx = canvas.getContext('2d')
      ctx.resetTransform()
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    writeFileSync(prefix + '-actual.png', actual.toBuffer('image/png'))
    writeFileSync(prefix + '-reference.png', expected.toBuffer('image/png'))
  }
  expect(area / reference).toBeGreaterThanOrEqual(0.85)
  expect(area / reference).toBeLessThanOrEqual(1.15)
  expect(difference / reference).toBeLessThan(0.05)
})
