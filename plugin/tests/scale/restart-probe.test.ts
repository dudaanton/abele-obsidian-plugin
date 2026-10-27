import { expect, it } from 'vitest'
import { restartModes } from './restart-probe-plan.mjs'

it('runs five uninstrumented restarts before a single CPU profile', () => {
  expect(restartModes(5)).toEqual([
    'control',
    'control',
    'control',
    'control',
    'control',
    'profile-only',
  ])
})
