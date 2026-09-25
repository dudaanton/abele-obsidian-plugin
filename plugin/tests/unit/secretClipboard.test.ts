/**
 * Copying a key: it goes onto the clipboard, and a minute later comes off it again if nothing
 * else has been copied since — where the device lets the plugin look, which a phone does not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CLEAR_AFTER_MS, copySecret, type SecretClipboard } from '@/secrets/clipboard'

function board(readable = true): SecretClipboard & { text: string } {
  const made = {
    text: 'before',
    write: vi.fn(async (text: string) => {
      made.text = text
    }),
    read: readable ? async () => made.text : null,
  }
  return made
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('copying a key', () => {
  it('puts it on the clipboard and takes it off after a minute if it is still there', async () => {
    const clip = board()
    const result = await copySecret('fake-value', clip)
    expect(result.clears).toBe(true)
    expect(clip.text).toBe('fake-value')

    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS - 1)
    expect(clip.text).toBe('fake-value')
    await vi.advanceTimersByTimeAsync(1)
    expect(clip.text).toBe('')
  })

  it('leaves alone whatever was copied after it', async () => {
    const clip = board()
    await copySecret('fake-value', clip)
    clip.text = 'something the person copied since'
    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS)
    expect(clip.text).toBe('something the person copied since')
  })

  it('where the clipboard cannot be read, never clears it and says so', async () => {
    const clip = board(false)
    const result = await copySecret('fake-value', clip)
    expect(result.clears).toBe(false)
    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS * 2)
    expect(clip.text).toBe('fake-value')
    expect(clip.write).toHaveBeenCalledTimes(1)
  })

  it('a clipboard that refuses to be read at clearing time is left as it is', async () => {
    const clip = board()
    clip.read = async () => {
      throw new Error('not allowed')
    }
    await copySecret('fake-value', clip)
    await vi.advanceTimersByTimeAsync(CLEAR_AFTER_MS)
    expect(clip.text).toBe('fake-value')
  })
})
