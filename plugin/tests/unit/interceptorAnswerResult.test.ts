/**
 * What an interceptor script's return value means for the agent's finished answer: it stays,
 * gives way to the script's text, or stays with a line under it. Anything else is a failure,
 * and a failure keeps the answer as it was.
 */
import { describe, it, expect } from 'vitest'
import { readAnswerResult } from '@/ai/interceptor/result'

const original = 'The lantern is on the shelf.'

describe('an answer check returning', () => {
  it('nothing, null or true keeps the answer', () => {
    for (const value of [undefined, null, true]) {
      expect(readAnswerResult(value, original)).toEqual({ kind: 'keep' })
    }
  })

  it('a string puts that text in the answer’s place', () => {
    expect(readAnswerResult('The lamp is on the shelf.', original)).toEqual({
      kind: 'replace',
      text: 'The lamp is on the shelf.',
    })
  })

  it('the same text as the answer keeps it', () => {
    expect(readAnswerResult(original, original)).toEqual({ kind: 'keep' })
    expect(readAnswerResult({ text: original }, original)).toEqual({ kind: 'keep' })
  })

  it('text with a note replaces it and leaves the note', () => {
    expect(readAnswerResult({ text: 'Fixed.', note: 'Corrected the place.' }, original)).toEqual({
      kind: 'replace',
      text: 'Fixed.',
      note: 'Corrected the place.',
    })
  })

  it('a note alone keeps the answer with the note under it', () => {
    expect(readAnswerResult({ note: 'Looks right.' }, original)).toEqual({
      kind: 'keep',
      note: 'Looks right.',
    })
  })

  it('an empty text, a number or a list is refused with a reason', () => {
    for (const value of ['', '   ', 3, ['a'], { text: '' }, { note: 4 }]) {
      const out = readAnswerResult(value, original)
      expect(out.kind).toBe('invalid')
    }
  })

  it('what only a message takes is refused, naming the key', () => {
    for (const key of ['reply', 'hold', 'attachments', 'approve', 'deny']) {
      const out = readAnswerResult({ [key]: 'x' }, original)
      expect(out).toMatchObject({ kind: 'invalid' })
      expect((out as { reason: string }).reason).toContain(`"${key}"`)
    }
  })
})
