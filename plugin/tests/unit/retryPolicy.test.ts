/**
 * Which failures are worth trying again, and how long to wait.
 *
 * Retrying a wrong API key five times is five identical refusals and a minute of waiting; the
 * things worth repeating are the ones that pass on their own — a rate limit, an overloaded
 * provider, a connection that dropped.
 */
import { describe, it, expect } from 'vitest'
import { isTransient, backoffDelay, DEFAULT_RETRY } from '@/ai/retry'

describe('what is worth trying again', () => {
  it.each([
    'HTTP 429: {"error":"rate limit"}',
    'HTTP 500: internal error',
    'HTTP 502: bad gateway',
    'HTTP 503: overloaded',
    'HTTP 504: gateway timeout',
    'HTTP 408: request timeout',
  ])('%s', (message) => {
    expect(isTransient(message)).toBe(true)
  })

  it.each([
    'Failed to fetch',
    'network error while reading the response',
    'The operation timed out',
    'socket hang up',
  ])('%s', (message) => {
    expect(isTransient(message)).toBe(true)
  })
})

describe('what is not', () => {
  it.each([
    'HTTP 401: invalid api key',
    'HTTP 403: forbidden',
    'HTTP 400: model not found',
    'HTTP 404: no such model',
    'HTTP 422: bad request',
    'Context window exceeded',
  ])('%s', (message) => {
    expect(isTransient(message)).toBe(false)
  })

  it('says nothing is transient about nothing at all', () => {
    expect(isTransient('')).toBe(false)
  })
})

describe('how long to wait', () => {
  it('doubles each time', () => {
    expect(backoffDelay(1, 2000)).toBe(2000)
    expect(backoffDelay(2, 2000)).toBe(4000)
    expect(backoffDelay(3, 2000)).toBe(8000)
  })

  /** Nobody waits four minutes for a chat message: the wait stops growing. */
  it('stops growing before the wait becomes absurd', () => {
    expect(backoffDelay(10, 2000)).toBeLessThanOrEqual(60_000)
    expect(backoffDelay(20, 2000)).toBe(backoffDelay(10, 2000))
  })

  it('starts where it is told to', () => {
    expect(backoffDelay(1, 500)).toBe(500)
  })
})

describe('by default', () => {
  it('does nothing without being asked', () => {
    expect(DEFAULT_RETRY.attempts).toBe(0)
  })
})
