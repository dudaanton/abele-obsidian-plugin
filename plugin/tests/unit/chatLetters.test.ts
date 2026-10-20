import { describe, expect, it, vi } from 'vitest'
import { ChatLetters, type LetterEndpoint } from '@/chats/chatLetters'

function endpoint(id: string, reply = async () => 'Answer'): LetterEndpoint {
  return { id, title: id, folder: '', agent: 'Helper', state: 'idle', receive: reply }
}

describe('chat letters', () => {
  it('does not deliver a request cancelled before the receiver starts', async () => {
    const receive = vi.fn(async () => 'Answer')
    const letters = new ChatLetters(() => [endpoint('a'), endpoint('b', receive)])
    const controller = new AbortController()
    const pending = letters.send('a', 'b', 'Question', controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('cancelled')
    expect(receive).not.toHaveBeenCalled()
  })
  it('lists only other open chats and returns the target answer', async () => {
    const letters = new ChatLetters(() => [endpoint('a'), endpoint('b')])
    expect(letters.list('a').map((c) => c.id)).toEqual(['b'])
    expect(await letters.send('a', 'b', 'Question')).toBe('Answer')
  })
  it('refuses self, unknown and closed targets', async () => {
    const letters = new ChatLetters(() => [endpoint('a')])
    await expect(letters.send('a', 'a', 'Question')).rejects.toThrow('own chat')
    await expect(letters.send('a', 'missing', 'Question')).rejects.toThrow('closed or unknown')
  })
  it('rejects cycles and concurrent asks to the same target', async () => {
    let finish!: (value: string) => void
    const b = endpoint(
      'b',
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const letters = new ChatLetters(() => [endpoint('a'), b, endpoint('c')])
    const pending = letters.send('a', 'b', 'Question')
    await expect(letters.send('b', 'a', 'Question')).rejects.toThrow('waiting')
    await expect(letters.send('c', 'b', 'Question')).rejects.toThrow('busy')
    finish('Done')
    await expect(pending).resolves.toBe('Done')
    expect(await letters.send('b', 'a', 'Next')).toBe('Answer')
  })
  it('releases reservations on cancellation even if a receiver never settles', async () => {
    const letters = new ChatLetters(() => [
      endpoint('a'),
      endpoint('b', () => new Promise(() => {})),
    ])
    const controller = new AbortController()
    const pending = letters.send('a', 'b', 'Question', controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toThrow('cancelled')
    expect(await letters.send('b', 'a', 'Next')).toBe('Answer')
  })
  it('rejects a cycle spanning three chats', async () => {
    const controller = new AbortController()
    const letters = new ChatLetters(() =>
      ['a', 'b', 'c'].map((id) => endpoint(id, () => new Promise(() => {})))
    )
    const first = letters.send('a', 'b', 'First', controller.signal)
    const second = letters.send('b', 'c', 'Second', controller.signal)
    await expect(letters.send('c', 'a', 'Third')).rejects.toThrow('waiting')
    controller.abort()
    await expect(first).rejects.toThrow('cancelled')
    await expect(second).rejects.toThrow('cancelled')
  })
})
