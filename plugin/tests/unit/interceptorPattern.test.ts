/**
 * Which messages an interceptor is shown.
 *
 * A pattern narrows the interceptor to the messages that match it; the rest go straight to the
 * chat's agent. It is a filter in front of something that may be a guard, so a pattern that
 * does not compile must never quietly switch the guard off: it lets everything through to the
 * interceptor, and says why.
 */
import { describe, it, expect } from 'vitest'
import { compilePattern, patternError, matchesPattern } from '@/ai/interceptor/pattern'

describe('a pattern', () => {
  it('takes every message when empty', () => {
    expect(matchesPattern('', 'anything at all')).toEqual({ matches: true })
    expect(matchesPattern('   ', 'anything at all')).toEqual({ matches: true })
  })

  it('is a bare regular expression, case-sensitive', () => {
    expect(matchesPattern('^/todo\\b', '/todo buy bread').matches).toBe(true)
    expect(matchesPattern('^/todo\\b', 'please /todo later').matches).toBe(false)
    expect(matchesPattern('^/todo\\b', '/TODO buy bread').matches).toBe(false)
  })

  it('may be written as a literal with flags', () => {
    expect(matchesPattern('/^\\/todo/i', '/TODO buy bread').matches).toBe(true)
    expect(compilePattern('/a.b/s')?.flags).toBe('s')
  })

  it('treats a slash inside a bare source as part of it', () => {
    expect(matchesPattern('a/b', 'see a/b here').matches).toBe(true)
  })

  it('answers the same for the same text however often it is asked, even with g or y', () => {
    for (let i = 0; i < 3; i++) {
      expect(matchesPattern('/draft/g', 'a draft').matches).toBe(true)
      expect(matchesPattern('/a/y', 'a').matches).toBe(true)
    }
  })

  it('matches across lines of a long message', () => {
    expect(matchesPattern('secret', 'first line\nthe secret word\nlast').matches).toBe(true)
  })

  it('says what is wrong with one that does not compile', () => {
    expect(patternError('([a-')).toMatch(/\S/)
    expect(patternError('/x/q')).toMatch(/\S/)
    expect(patternError('^ok$')).toBeNull()
    expect(patternError('')).toBeNull()
  })

  it('lets everything through to the interceptor when it does not compile, and says why', () => {
    const out = matchesPattern('([a-', 'hello')
    expect(out.matches).toBe(true)
    expect(out.broken).toMatch(/\S/)
  })
})
