/**
 * Trying a failed request again, on its own.
 *
 * Two rules. Only failures that pass by themselves are repeated — a rate limit, an overloaded
 * provider, a connection that dropped — because retrying a rejected key just spends the time
 * five times over. And the wait doubles, so a provider that is having a bad minute is not
 * hammered while it recovers.
 */

import type { RetrySettings } from './types'
import { uiMessage, type UiMessage } from '@/i18n/streamBErrors'

export type { RetrySettings }

/** Show Responses diagnostics with a localized hint; retain other providers' presentation. */
export function providerErrorPresentation(error: string): UiMessage | null {
  if (/^(HTTP \d{3}: )?Responses request failed/.test(error))
    return uiMessage('streamB.responsesFailure', {
      details: error
        .replace(/Responses request failed(?:: )?/, '')
        .trim()
        .slice(0, 1200),
    })
  return /\bHTTP\s+5\d{2}\b/i.test(error) ? uiMessage('streamB.providerUnavailable') : null
}

export const DEFAULT_RETRY: RetrySettings = {
  attempts: 0,
  firstDelayMs: 2000,
}

/** Nobody waits this long for a chat message to go out. */
const MAX_DELAY_MS = 60_000

/** HTTP codes that mean "not now" rather than "not ever". */
const TRANSIENT_CODES = [408, 409, 425, 429]

/** What a dropped connection looks like once it reaches us as text. */
const TRANSIENT_TEXT = /failed to fetch|network|timed out|timeout|socket|econn|temporarily/i

export function isTransient(error: string): boolean {
  if (!error) return false

  const status = /HTTP (\d{3})/.exec(error)
  if (status) {
    const code = Number(status[1])
    return code >= 500 || TRANSIENT_CODES.includes(code)
  }

  const providerCode = /^Responses request failed: \[([^\]]+)\]/.exec(error)?.[1]
  if (providerCode) {
    if (
      /invalid_request|auth|permission|model_not_found|content_policy|content_filter|insufficient_quota/i.test(
        providerCode
      )
    )
      return false
    if (
      /^(server_error|internal_server_error|internal_error|rate_limit_exceeded|rate_limit_error|overloaded|overloaded_error|request_timeout|timeout|timeout_error|service_unavailable|bad_gateway|gateway_timeout|5\d{2})$/i.test(
        providerCode
      )
    )
      return true
  }

  return TRANSIENT_TEXT.test(error)
}

/** @param attempt which retry this is, counting from one */
export function backoffDelay(attempt: number, firstDelayMs: number): number {
  return Math.min(MAX_DELAY_MS, firstDelayMs * 2 ** (attempt - 1))
}
