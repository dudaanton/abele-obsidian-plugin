import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('native comment workflow regression boundaries', () => {
  it('keeps geometry, persistence, source safety and formatting as ordinary blocking checks', () => {
    const source = readFileSync('tests/e2e/textComments.e2e.test.ts', 'utf8')
    expect(source).not.toContain('it.skipIf(!onPhone()).fails(')
    for (const property of ['keyboard', 'saved', 'edited', 'sourceUnchanged']) {
      expect(source).toContain(`expect(result.${property}).toBe(true)`)
    }
    expect(source).toContain('expect(result.room).toBeGreaterThan(150)')
    for (const property of ['clicked', 'formatted', 'italic', 'selectionKept', 'keyboard']) {
      expect(source).toContain(`expect(nativeToolbar?.${property}).toBe(true)`)
    }
  })
})
