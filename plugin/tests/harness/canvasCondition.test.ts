import { describe, expect, it } from 'vitest'
import { canvasCondition } from '../e2e/helpers/canvasCondition'

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
