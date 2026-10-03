// @vitest-environment node
import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { sameNativeClipboard } from '../e2e/helpers/nativeClipboard'
it('a last-format-only clipboard restore cannot certify an original multiformat item', () => {
  const original = JSON.stringify([
    [
      ['text/plain', 'c2FtcGxl'],
      ['sample/custom', 'AP8='],
    ],
  ])
  expect(sameNativeClipboard(original, JSON.stringify([[['sample/custom', 'AP8=']]]))).toBe(false)
  expect(
    sameNativeClipboard(
      original,
      JSON.stringify([
        [
          ['sample/custom', 'AP8='],
          ['text/plain', 'c2FtcGxl'],
        ],
      ])
    )
  ).toBe(true)
})
it('native paste uses an exact all-item/type archive, not an overwriting Electron writeBuffer loop', () => {
  const source = readFileSync(new URL('../e2e/helpers/nativePaste.ts', import.meta.url), 'utf8')
  expect(source).toContain('captureNativeClipboard()')
  expect(source).toContain('restoreNativeClipboard(archive)')
  expect(source).not.toContain('clipboard.writeBuffer(')
})
