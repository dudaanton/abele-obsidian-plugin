import { describe, expect, it, vi } from 'vitest'
import { commitWordWrite } from '@/word/write'

describe('Word final storage checks', () => {
  it('refuses a competing version observed by the final read, without writing', async () => {
    const original = Uint8Array.from([1])
    const competing = Uint8Array.from([2])
    const edited = Uint8Array.from([3])
    const write = vi.fn(async () => {})
    await expect(
      commitWordWrite({ read: async () => competing, write }, original, edited)
    ).rejects.toThrow(/changed/i)
    expect(write).not.toHaveBeenCalled()
  })
  it('reports a conflict instead of success when another version appears after the write', async () => {
    const original = Uint8Array.from([1])
    const competing = Uint8Array.from([2])
    const edited = Uint8Array.from([3])
    let stored = original
    await expect(
      commitWordWrite(
        {
          read: async () => stored.slice(),
          write: async (bytes) => {
            stored = bytes
            stored = competing
          },
        },
        original,
        edited
      )
    ).rejects.toThrow(/changed while saving.*reopen/i)
    expect(stored).toEqual(competing)
  })
  it('reports a conflict when the saved version disappears before read-back', async () => {
    const original = Uint8Array.from([1])
    const edited = Uint8Array.from([3])
    let written = false
    await expect(
      commitWordWrite(
        {
          read: async () => {
            if (written) throw new Error('sample file is unavailable')
            return original
          },
          write: async () => {
            written = true
          },
        },
        original,
        edited
      )
    ).rejects.toThrow(/changed while saving.*reopen/i)
  })

  it('accepts an identical result read back from storage', async () => {
    const original = Uint8Array.from([1])
    const edited = Uint8Array.from([3])
    let stored = original
    const calls: string[] = []
    await commitWordWrite(
      {
        read: async () => {
          calls.push('read')
          return stored.slice()
        },
        write: async (bytes) => {
          calls.push('write')
          stored = bytes
        },
      },
      original,
      edited
    )
    expect(calls).toEqual(['read', 'write', 'read'])
    expect(stored).toEqual(edited)
  })
})
