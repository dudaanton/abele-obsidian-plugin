import { describe, expect, it } from 'vitest'
import {
  canvasCondition,
  canvasTypingState,
  shortCanvasQuery,
} from '../e2e/helpers/canvasCondition'

const evaluate = (body: string, probe: () => unknown) =>
  new Function('probe', `return (async()=>{${body}})()`)(probe)

describe('canvas condition evaluated inside the page', () => {
  it('waits locally and returns the first reachable geometry', async () => {
    let calls = 0
    const point = [20, 40]
    expect(
      await evaluate(canvasCondition('return probe()', 1000), () => (++calls === 1 ? null : point))
    ).toEqual(point)
    expect(calls).toBe(2)
  })

  it('fails when the condition never arrives', async () => {
    await expect(evaluate(canvasCondition('return probe()', 5), () => null)).rejects.toThrow(
      'Canvas condition did not become ready'
    )
  })

  it('keeps waiting through a temporarily missing view', async () => {
    let calls = 0
    expect(
      await evaluate(canvasCondition('return probe()', 1000), () => {
        if (++calls === 1) throw new Error('View is mounting')
        return true
      })
    ).toBe(true)
    expect(calls).toBe(2)
  })
})

describe('canvas picker input', () => {
  it('uses a short query which only the complete target path can match', () => {
    const target = 'Sample/sample-assets/sample-image.svg'
    const paths = [target, 'Sample/sample-assets/sample-drawing.svg', 'Other/image.md']
    const query = shortCanvasQuery(target, paths)
    expect(query.length).toBeLessThan('sample-image.svg'.length)
    const matches = paths.filter((path) => {
      let at = 0
      for (const char of path.toLowerCase()) if (char === query[at]) at++
      return at === query.length
    })
    expect(matches).toEqual([target])
  })

  it('distinguishes equal basenames using their full path', () => {
    expect(shortCanvasQuery('One/a.svg', ['One/a.svg', 'Two/a.svg'])).toBe('One/a.svg')
  })

  it('can run inside the page without module bindings', () => {
    const query = new Function(
      `return (${shortCanvasQuery.toString()})`
    )() as typeof shortCanvasQuery
    expect(query('Sample/image.svg', ['Sample/image.svg', 'Sample/drawing.svg'])).toBe(
      shortCanvasQuery('Sample/image.svg', ['Sample/image.svg', 'Sample/drawing.svg'])
    )
  })

  it('reads the expected typed value in the same eval that waits for keyboard readiness', async () => {
    const field = { value: 'sample', selectionStart: 1, selectionEnd: 4, matches: () => true }
    const page = new Function(
      'document',
      'window',
      'getComputedStyle',
      'innerHeight',
      `return (async()=>{${canvasTypingState('x')}})()`
    )
    expect(
      await page(
        { activeElement: field, body: {} },
        {},
        () => ({ getPropertyValue: () => '300' }),
        800
      )
    ).toEqual({ expected: 'sxle' })
  })
})
