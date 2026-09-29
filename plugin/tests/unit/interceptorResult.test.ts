/**
 * What an interceptor script's return value means.
 *
 * The script decides what becomes of a message: it goes on as written, goes on rewritten, is
 * answered by the script itself, or is held back for the person. Anything the plugin cannot
 * read as one of those is a failure, and a failure sends the message as written — it is never
 * guessed at.
 */
import { describe, it, expect } from 'vitest'
import { readInterceptResult } from '@/ai/interceptor/result'

const original = { text: 'hello there', attachments: ['notes/sample-note.md'] }

describe('an interceptor script returning', () => {
  it('nothing, null or true sends the message as written', () => {
    for (const value of [undefined, null, true]) {
      expect(readInterceptResult(value, original)).toEqual({
        kind: 'send',
        text: 'hello there',
        attachments: ['notes/sample-note.md'],
        rewritten: false,
      })
    }
  })

  it('a string sends that text instead, keeping the attachments', () => {
    expect(readInterceptResult('HELLO THERE', original)).toEqual({
      kind: 'send',
      text: 'HELLO THERE',
      attachments: ['notes/sample-note.md'],
      rewritten: true,
    })
  })

  it('an object with text and attachments replaces both', () => {
    const out = readInterceptResult({ text: 'new', attachments: [] }, original)
    expect(out).toMatchObject({ kind: 'send', text: 'new', attachments: [], rewritten: true })
  })

  it('an object without text keeps the text and may still carry a tool policy', () => {
    const out = readInterceptResult({ approve: ['edit'] }, original)
    expect(out).toMatchObject({ kind: 'send', text: 'hello there', rewritten: false })
    if (out.kind !== 'send') throw new Error('expected send')
    expect(out.policy).toEqual({ approve: ['edit'], deny: [] })
  })

  it('the same text is not counted as a rewrite', () => {
    expect(readInterceptResult({ text: 'hello there' }, original)).toMatchObject({
      rewritten: false,
    })
  })

  it('approve and deny are read as they come', () => {
    const decide = () => true
    const out = readInterceptResult({ approve: decide, deny: ['rm'] }, original)
    if (out.kind !== 'send') throw new Error('expected send')
    expect(out.policy?.approve).toBe(decide)
    expect(out.policy?.deny).toEqual(['rm'])
    const all = readInterceptResult({ approve: true }, original)
    if (all.kind !== 'send') throw new Error('expected send')
    expect(all.policy?.approve).toBe(true)
  })

  it('reply answers in its place', () => {
    expect(readInterceptResult({ reply: 'Added to the list.' }, original)).toEqual({
      kind: 'reply',
      text: 'Added to the list.',
    })
  })

  it('hold keeps the message back with the reason', () => {
    expect(readInterceptResult({ hold: 'It names a password.' }, original)).toEqual({
      kind: 'hold',
      reason: 'It names a password.',
    })
  })

  it('anything else is a failure with a reason', () => {
    const unusable = [
      '',
      '   ',
      42,
      false,
      [],
      { reply: '' },
      { hold: '' },
      { reply: 'a', hold: 'b' },
      { text: 5 },
      { text: '' },
      { attachments: 'one.md' },
      { approve: 'yes' },
      { approve: ['edit', 3] },
      { deny: true },
      { reply: 'a', approve: true },
      { surprise: 1 },
    ]
    for (const value of unusable) {
      const out = readInterceptResult(value, original)
      expect(out.kind, JSON.stringify(value)).toBe('invalid')
      if (out.kind === 'invalid') expect(out.reason).toMatch(/\S/)
    }
  })
})
