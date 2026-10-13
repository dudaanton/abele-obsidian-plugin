import { describe, expect, it } from 'vitest'
import { failedSetup, type RunTask } from '../e2e/helpers/failFastRunner'

const test = (state: string, extra: Partial<RunTask> = {}): RunTask => ({
  type: 'test',
  name: 'sample case',
  result: { state },
  ...extra,
})
const suite = (tasks: RunTask[], errors: string[] = [], file = false): RunTask => {
  const node: RunTask = {
    type: 'suite',
    name: 'sample part',
    tasks,
    result: {
      state: errors.length ? 'fail' : 'pass',
      errors: errors.map((message) => ({ message })),
    },
  }
  node.file = file ? node : undefined
  return node
}

describe('e2e fail-fast on a failed setup', () => {
  it('stops a file when a part’s setup failed and none of its cases ran', () => {
    expect(failedSetup(suite([test('skip'), test('skip')], ['fixture missing']), false)).toMatch(
      /setup of "sample part" failed: fixture missing/
    )
  })

  it('goes on when the part’s cases ran and only its teardown failed', () => {
    expect(failedSetup(suite([test('pass'), test('skip')], ['cleanup failed']), false)).toBe(
      undefined
    )
  })

  it('goes on after a part whose cases failed on their own', () => {
    expect(failedSetup(suite([test('fail'), test('pass')]), false)).toBe(undefined)
  })

  it('leaves the file itself to vitest, which already skips everything after its setup', () => {
    expect(failedSetup(suite([test('skip')], ['setup failed'], true), false)).toBe(undefined)
  })

  it('stops a file when a case failed before its body started: its per-case setup failed', () => {
    expect(
      failedSetup(
        test('fail', { result: { state: 'fail', errors: [{ message: 'no tab' }] } }),
        false
      )
    ).toMatch(/setup of "sample case" failed: no tab/)
  })

  it('goes on after a case whose own body failed, or that was skipped', () => {
    expect(failedSetup(test('fail'), true)).toBe(undefined)
    expect(failedSetup(test('skip'), false)).toBe(undefined)
    expect(failedSetup(test('pass'), false)).toBe(undefined)
  })
})
