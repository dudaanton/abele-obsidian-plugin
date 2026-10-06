export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 60
export const MAX_REQUEST_TIMEOUT_SECONDS = 3600

/** Old settings and malformed incoming values keep the existing one-minute wait. */
export function requestTimeoutSeconds(value: unknown): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= MAX_REQUEST_TIMEOUT_SECONDS
    ? value
    : DEFAULT_REQUEST_TIMEOUT_SECONDS
}
