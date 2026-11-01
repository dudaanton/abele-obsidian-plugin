import { describe, expect, it } from 'vitest'
import { summarizeWire } from './wire-summary.mjs'

describe('wire checkpoint summary', () => {
  it('groups flat checkpoint events by device before joining reused request ids', () => {
    const rows = [
      {
        event: 'start',
        device: '0',
        id: 1,
        route: '/commit',
        method: 'POST',
        operations: [{}, {}],
        headers: { authorization: 'sample-private' },
      },
      { event: 'start', device: '1', id: 1, route: '/head', method: 'GET' },
      { event: 'finish', device: '1', id: 1, status: 200, bytes: 30, at: 10 },
      { event: 'finish', device: '0', id: 1, status: 201, bytes: 20, at: 11 },
    ]
    const result = summarizeWire(rows)
    expect(result).toHaveLength(2)
    expect(result[0].tail[0]).toEqual({
      at: 11,
      route: '/commit',
      method: 'POST',
      status: 201,
      bytes: 20,
      operations: 2,
    })
    expect(result[1].tail[0].route).toBe('/head')
    expect(JSON.stringify(result)).not.toContain('sample-private')
  })

  it('bounds each tail without losing complete status totals and accepts grouped events', () => {
    const events = Array.from({ length: 50 }, (_, id) => ({
      event: 'finish',
      id,
      status: 200,
      at: id,
    }))
    const result = summarizeWire([{ events }], 3)
    expect(result).toHaveLength(1)
    expect(result[0].statuses).toEqual({ 200: 50 })
    expect(result[0].tail.map((row: any) => row.at)).toEqual([47, 48, 49])
    expect(summarizeWire([])).toEqual([])
  })
})
