/**
 * Trying a failed request again, on its own.
 *
 * Two rules. Only failures that pass by themselves are repeated — a rate limit, an overloaded
 * provider, a connection that dropped — because retrying a rejected key just spends the time
 * five times over. And the wait doubles, so a provider that is having a bad minute is not
 * hammered while it recovers.
 */

import type { RetrySettings } from './types'

export type { RetrySettings }

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

  return TRANSIENT_TEXT.test(error)
}

/** @param attempt which retry this is, counting from one */
export function backoffDelay(attempt: number, firstDelayMs: number): number {
  return Math.min(MAX_DELAY_MS, firstDelayMs * 2 ** (attempt - 1))
}
