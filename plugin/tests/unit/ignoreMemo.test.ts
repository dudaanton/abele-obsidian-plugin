import { expect, it, vi } from 'vitest'
import { IgnoreRules } from '@abele/sync-sdk/core'
import { ignoreFor } from '@/sync/scope'

it('checks a stable path once for each parsed ignore policy', () => {
  const checked = vi.fn((path: string) => path === 'Notes/skip.md')
  const parse = vi.spyOn(IgnoreRules, 'parse').mockReturnValue({ ignores: checked } as never)
  try {
    const first = ignoreFor('.obsidian', 'skip.md')
    for (let i = 0; i < 5; i++) {
      expect(first.ignores('Notes/sample.md')).toBe(false)
      expect(first.ignores('Notes/skip.md')).toBe(true)
    }
    expect(checked).toHaveBeenCalledTimes(2)
    const next = ignoreFor('.obsidian', 'other.md')
    expect(next.ignores('Notes/sample.md')).toBe(false)
    expect(checked).toHaveBeenCalledTimes(3)
  } finally {
    parse.mockRestore()
  }
})
