import { describe, expect, it } from 'vitest'
import { drawingSvg } from '@/drawing/drawingFile'
import { convertDrawings, type DrawingMigrationStore } from '@/drawing/conversion'

function store(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial))
  const io: DrawingMigrationStore = {
    paths: () => [...files.keys()],
    read: async (path) => files.get(path)!,
    exists: (path) => files.has(path),
    create: async (path, text) => {
      if (files.has(path)) throw new Error('Already exists')
      files.set(path, text)
    },
  }
  return { files, io }
}
const stroke = {
  id: 'sample',
  type: 'stroke' as const,
  tool: 'pen' as const,
  color: 'blue' as const,
  size: 4,
  points: [-10, 20, 0.2, 50, 60, 0.8],
  linear: true as const,
}

describe('legacy drawing conversion', () => {
  it('does not collapse identical drawings that still exist at separate paths', async () => {
    const source = drawingSvg({ items: [stroke] })
    const { files, io } = store({ 'First.svg': source })
    await convertDrawings(io)
    files.set('Second.svg', source)
    expect((await convertDrawings(io)).map((result) => result.status)).toEqual([
      'existing',
      'converted',
    ])
    expect(files.has('Second.canvas')).toBe(true)
  })

  it('recognises a folder move that moves both source and converted canvas', async () => {
    const source = drawingSvg({ items: [{ ...stroke, linear: undefined }] })
    const { files, io } = store({ 'Folder/Sketch.svg': source })
    await convertDrawings(io)
    const canvas = files.get('Folder/Sketch.canvas')!
    files.clear()
    files.set('Moved/Sketch.svg', source)
    files.set('Moved/Sketch.canvas', canvas)
    expect(await convertDrawings(io)).toEqual([
      { source: 'Moved/Sketch.svg', destination: 'Moved/Sketch.canvas', status: 'existing' },
    ])
    expect(files.size).toBe(2)
    expect(files.get('Moved/Sketch.svg')).toBe(source)
  })
  it.each(['Renamed.svg', 'Other/Sketch.svg', 'Moved/Folder/Sketch.svg'])(
    'recognises an earlier conversion after moving the original to %s',
    async (destination) => {
      const source = drawingSvg({ items: [stroke] })
      const { files, io } = store({ 'Folder/Sketch.svg': source })
      await convertDrawings(io)
      const canvas = files.get('Folder/Sketch.canvas')!
      files.delete('Folder/Sketch.svg')
      files.set(destination, source)
      const before = [...files]
      expect(await convertDrawings(io)).toEqual([
        { source: destination, destination: 'Folder/Sketch.canvas', status: 'existing' },
      ])
      expect([...files]).toEqual(before)
      expect(files.get('Folder/Sketch.canvas')).toBe(canvas)
    }
  )
  it.each([
    { size: -1 },
    { size: 3000 },
    { color: 'unknown' },
    { freedraw: { simulatePressure: false, streamline: 2 } },
    { freedraw: { simulatePressure: 'yes', streamline: 0.5 } },
    { linear: 'true' },
    { points: [0, 0, -0.1] },
    { d: [0, 0, 50, 1, 1, 60], points: undefined },
  ])('refuses raw fields the display reader would normalize: %j', async (fields) => {
    const source = drawingSvg({ items: [stroke] }).replace(
      /<metadata id="abele-drawing">[\s\S]*?<\/metadata>/,
      `<metadata id="abele-drawing">${JSON.stringify({ v: 1, items: [{ ...stroke, ...fields }] })}</metadata>`
    )
    const { files, io } = store({ 'Invalid.svg': source })
    expect((await convertDrawings(io))[0]).toMatchObject({ status: 'failed' })
    expect([...files]).toEqual([['Invalid.svg', source]])
  })
  it('preserves ink and source bytes, and repeating creates nothing', async () => {
    const source = drawingSvg({ items: [stroke] })
    const { files, io } = store({ 'Sketch.svg': source, 'Sketch.canvas': 'unrelated' })
    expect(await convertDrawings(io)).toEqual([
      { source: 'Sketch.svg', destination: 'Sketch 2.canvas', status: 'converted' },
    ])
    const canvas = JSON.parse(files.get('Sketch 2.canvas')!)
    const { type: _type, ...ink } = stroke
    expect(canvas.abele.ink).toEqual([{ ...ink, color: '#1864d6', version: 1 }])
    expect(files.get('Sketch.svg')).toBe(source)
    expect(files.get('Sketch.canvas')).toBe('unrelated')
    const before = [...files]
    expect((await convertDrawings(io))[0].status).toBe('existing')
    expect([...files]).toEqual(before)
  })
  it('does not duplicate after the source changes or the canvas is edited', async () => {
    const { files, io } = store({ 'Sketch.svg': drawingSvg({ items: [stroke] }) })
    await convertDrawings(io)
    const canvas = JSON.parse(files.get('Sketch.canvas')!)
    canvas.nodes.push({
      id: 'edit',
      type: 'text',
      text: 'kept',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    files.set('Sketch.canvas', JSON.stringify(canvas))
    files.set('Sketch.svg', drawingSvg({ items: [] }))
    expect((await convertDrawings(io))[0].status).toBe('existing')
    expect(files.size).toBe(2)
    expect(JSON.parse(files.get('Sketch.canvas')!).nodes[0].text).toBe('kept')
  })
  it('retains mixed content as an original preview alongside editable ink', async () => {
    const { files, io } = store({
      'Mixed.svg': drawingSvg({
        items: [
          stroke,
          { id: 'caption', type: 'text', text: 'Sample', x: 20, y: 30, color: 'blue', size: 20 },
        ],
      }),
    })
    await convertDrawings(io)
    const canvas = JSON.parse(files.get('Mixed.canvas')!)
    expect(canvas.nodes[0]).toMatchObject({ type: 'file', file: 'Mixed.svg' })
    expect(canvas.abele.ink).toHaveLength(1)
  })
  it('isolates malformed files without modifying them', async () => {
    const { files, io } = store({
      'Bad.svg': '<svg data-abele-drawing="1"><metadata id="abele-drawing">broken</metadata></svg>',
      'Good.svg': drawingSvg({ items: [stroke] }),
      'Photo.svg': '<svg/>',
    })
    const result = await convertDrawings(io)
    expect(result.map((r) => r.status)).toEqual(['failed', 'converted'])
    expect(files.has('Bad.canvas')).toBe(false)
  })

  it('reports publication failure and can retry without a false completion record', async () => {
    const source = drawingSvg({ items: [stroke] })
    const { files, io } = store({ 'Sketch.svg': source })
    const failed = await convertDrawings({
      ...io,
      create: async () => {
        throw new Error('Write failed')
      },
    })
    expect(failed[0]).toMatchObject({ status: 'failed', error: 'Error: Write failed' })
    expect([...files]).toEqual([['Sketch.svg', source]])
    expect((await convertDrawings(io))[0].status).toBe('converted')
  })

  it('preserves marker pressure and freedraw profile and refuses future metadata', async () => {
    const marker = {
      ...stroke,
      tool: 'marker' as const,
      color: 'yellow' as const,
      freedraw: { simulatePressure: false, streamline: 0.4 },
    }
    const future = drawingSvg({ items: [stroke] }).replace('"v":1', '"v":2')
    const { files, io } = store({
      'Marker.svg': drawingSvg({ items: [marker] }),
      'Future.svg': future,
    })
    const results = await convertDrawings(io)
    expect(results.map((r) => r.status)).toEqual(['converted', 'failed'])
    expect(JSON.parse(files.get('Marker.canvas')!).abele.ink[0]).toMatchObject({
      tool: 'marker',
      color: '#f5c400',
      points: marker.points,
      freedraw: marker.freedraw,
      linear: true,
    })
    expect(files.get('Future.svg')).toBe(future)
    expect(files.has('Future.canvas')).toBe(false)
  })
})
