/**
 * Which failures are worth trying again, and how long to wait.
 *
 * Retrying a wrong API key five times is five identical refusals and a minute of waiting; the
 * things worth repeating are the ones that pass on their own — a rate limit, an overloaded
 * provider, a connection that dropped.
 */
import { describe, it, expect } from 'vitest'
import { isTransient, backoffDelay, DEFAULT_RETRY, providerErrorPresentation } from '@/ai/retry'
import { presentUiMessage } from '@/i18n/streamBErrors'

it('shows provider details alongside the plain-language hint', () => {
  for (const error of [
    'Responses request failed: [server_error] Upstream busy',
    'HTTP 503: Responses request failed: Upstream busy',
  ]) {
    const presentation = providerErrorPresentation(error)
    expect(presentation).not.toBeNull()
    const text = presentUiMessage(presentation!)
    expect(text).toContain('Upstream busy')
    expect(text).toContain('Check the provider configuration or retry.')
    expect(text).toContain(error.startsWith('HTTP') ? 'HTTP 503' : '[server_error]')
  }
})

it.each([
  'server_error',
  'rate_limit_exceeded',
  'overloaded',
  'overloaded_error',
  'internal_server_error',
  'request_timeout',
  'timeout',
])('retries provider code %s', (code) => {
  expect(isTransient(`Responses request failed: [${code}] Provider could not complete`)).toBe(true)
})
it.each([
  'invalid_request',
  'invalid_request_error',
  'authentication_error',
  'model_not_found',
  'content_policy_violation',
])('does not retry permanent provider code %s', (code) => {
  expect(isTransient(`Responses request failed: [${code}] Network timeout setting rejected`)).toBe(
    false
  )
})

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
