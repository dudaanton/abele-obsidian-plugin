import { describe, expect, it, vi } from 'vitest'
import { ChatLetters, type LetterEndpoint } from '@/chats/chatLetters'

function endpoint(id: string, reply = async () => 'Answer'): LetterEndpoint {
  return {
    id,
    title: id,
    folder: '',
    agent: { id: 'helper', name: 'Helper' },
    state: 'idle',
    receive: reply,
  }
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
  it('rejects cycles and queues concurrent asks to the same target without overlap', async () => {
    let finish!: (value: string) => void
    const receive = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue('Queued answer')
    const b = endpoint('b', receive)
    const letters = new ChatLetters(() => [endpoint('a'), b, endpoint('c')])
    const pending = letters.send('a', 'b', 'Question')
    await expect(letters.send('b', 'a', 'Question')).rejects.toThrow('waiting')
    const queued = letters.send('c', 'b', 'Question').then(
      (answer) => ({ answer }),
      (error) => ({ error })
    )
    expect(receive).toHaveBeenCalledTimes(1)
    finish('Done')
    await expect(pending).resolves.toBe('Done')
    expect(await queued).toEqual({ answer: 'Queued answer' })
    expect(receive).toHaveBeenCalledTimes(2)
    expect(await letters.send('b', 'a', 'Next')).toBe('Answer')
  })
  it('keeps cycle protection for parallel requests from the same caller until each completes', async () => {
    let firstDone!: (reply: string) => void
    let secondDone!: (reply: string) => void
    const receive = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            firstDone = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            secondDone = resolve
          })
      )
    const letters = new ChatLetters(() => [endpoint('a'), endpoint('b', receive)])
    const first = letters.send('a', 'b', 'First')
    const second = letters.send('a', 'b', 'Second').then(
      (answer) => ({ answer }),
      (error) => ({ error })
    )
    await vi.waitFor(() => expect(firstDone).toBeDefined())
    firstDone('First reply')
    await expect(first).resolves.toBe('First reply')
    await vi.waitFor(() => expect(secondDone).toBeDefined())
    await expect(letters.send('b', 'a', 'Cycle')).rejects.toThrow('waiting')
    secondDone('Second reply')
    expect(await second).toEqual({ answer: 'Second reply' })
    expect(await letters.send('b', 'a', 'Next')).toBe('Answer')
  })
  it('does not let cancellation of a queued request overlap the preceding receiver', async () => {
    let finish!: (reply: string) => void
    const receive = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue('Next reply')
    const letters = new ChatLetters(() =>
      ['a', 'c', 'd'].map((id) => endpoint(id)).concat(endpoint('b', receive))
    )
    const first = letters.send('a', 'b', 'First')
    await vi.waitFor(() => expect(finish).toBeDefined())
    const controller = new AbortController()
    const cancelled = letters.send('c', 'b', 'Cancelled', controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toThrow('cancelled')
    const next = letters.send('d', 'b', 'Next').then(
      (answer) => ({ answer }),
      (error) => ({ error })
    )
    await Promise.resolve()
    expect(receive).toHaveBeenCalledTimes(1)
    finish('First reply')
    await expect(first).resolves.toBe('First reply')
    expect(await next).toEqual({ answer: 'Next reply' })
    expect(receive).toHaveBeenCalledTimes(2)
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
