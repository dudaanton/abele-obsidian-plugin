import { describe, it, expect, beforeEach } from 'vitest'
import { LOAD_MARKS, markLoad, EVAL_START_INTRO } from '@/helpers/loadMarks'

describe('load marks', () => {
  beforeEach(() => performance.clearMarks())

  it('leaves a performance mark under the name the load-time probe reads', () => {
    markLoad('onloadStart')
    const entries = performance.getEntriesByName(LOAD_MARKS.onloadStart, 'mark')
    expect(entries).toHaveLength(1)
  })

  it('names every mark under the plugin prefix, so they never collide with another plugin', () => {
    for (const name of Object.values(LOAD_MARKS)) expect(name.startsWith('abele:')).toBe(true)
  })

  it('opens the bundle with the eval-start mark, and survives a host without performance', () => {
    expect(EVAL_START_INTRO).toContain(LOAD_MARKS.evalStart)
    new Function(EVAL_START_INTRO)()
    expect(performance.getEntriesByName(LOAD_MARKS.evalStart, 'mark')).toHaveLength(1)
    expect(() => new Function('performance', EVAL_START_INTRO)(undefined)).not.toThrow()
  })
})
