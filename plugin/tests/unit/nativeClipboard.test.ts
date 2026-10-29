// @vitest-environment node
import { it, expect, vi, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { restoreNativeClipboard, sameNativeClipboard } from '../e2e/helpers/nativeClipboard'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
afterEach(() => vi.resetAllMocks())

it('verifies restoration in the writer process while native items remain alive', () => {
  vi.mocked(execFileSync).mockReturnValue('[]')
  restoreNativeClipboard('[]')
  expect(execFileSync).toHaveBeenCalledTimes(1)
  const script = vi.mocked(execFileSync).mock.calls[0][1] as string[]
  expect(script[3]).toContain('pb.writeObjects')
  expect(script[3]).toContain('items=pb.pasteboardItems')
})

it('still refuses an inexact native restore immediately', () => {
  vi.mocked(execFileSync).mockReturnValue('[]')
  expect(() => restoreNativeClipboard('[[["sample/custom","AP8="]]]')).toThrow(
    'Native clipboard exact restoration failed'
  )
  expect(execFileSync).toHaveBeenCalledTimes(1)
})
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
