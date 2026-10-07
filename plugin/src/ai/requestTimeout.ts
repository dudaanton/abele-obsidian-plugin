export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 60
export const MAX_REQUEST_TIMEOUT_SECONDS = 3600

const validTimeout = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 1 &&
  value <= MAX_REQUEST_TIMEOUT_SECONDS

/** A model without a valid override follows the global value, then the one-minute default. */
export function requestTimeoutSeconds(value: unknown, fallback?: unknown): number {
  return validTimeout(value)
    ? value
    : validTimeout(fallback)
      ? fallback
      : DEFAULT_REQUEST_TIMEOUT_SECONDS
}
