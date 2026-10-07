import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('native comment workflow regression boundaries', () => {
  it('keeps geometry, persistence and source safety outside the toolbar expected failure', () => {
    const source = readFileSync('tests/e2e/textComments.e2e.test.ts', 'utf8')
    const start = source.indexOf('it.skipIf(!onPhone()).fails(')
    const end = source.indexOf("it('reading mode", start)
    const expectedFailure = source.slice(start, end)
    expect(expectedFailure).not.toMatch(
      /expect\(result\.(?:keyboard|room|saved|edited|sourceUnchanged|shots)/
    )
    expect(expectedFailure).not.toContain('const result = run')
  })
})
