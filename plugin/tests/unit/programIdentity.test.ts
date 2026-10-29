import { expect, it } from 'vitest'
import { isFixtureProgram } from '../e2e/helpers/programIdentity'

it('distinguishes identical inspector commands by exact fixture PID', () => {
  const command = 'node --inspect=127.0.0.1:0 src/serve.js'
  const own = { title: command, note: "This chat's folder · …/sample/app · pid 101 · port 9001" }
  const foreign = { title: command, note: '…/other/app · pid 1010 · port 9002' }
  expect(isFixtureProgram(own, [101])).toBe(true)
  expect(isFixtureProgram(foreign, [101])).toBe(false)
  // An ended fixture process disappearing does not mean every matching script must disappear.
  expect([foreign].filter((row) => isFixtureProgram(row, [101]))).toEqual([])
})
