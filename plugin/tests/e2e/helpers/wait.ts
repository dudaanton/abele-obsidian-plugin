/** A deliberate observation/gesture duration, not a readiness check. */
export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The condition poller from githubLive's prelude, shared by host code and eval scripts.
 * Returns the first truthy value, or null when the allowance expires. Callers must still
 * assert the result (or throw with their own diagnostic); expiry is never success.
 */
export async function until<T>(fn: () => T | Promise<T>, ms = 15_000): Promise<T | null> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch {
      // Mounting and indexing can temporarily make a predicate's target unavailable.
    }
    const remaining = deadline - Date.now()
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)))
  }
  return null
}

/** Explicit, eval-local bindings: no product test API or persistent window globals needed. */
export const WAIT_PRELUDE = `const wait = ${wait.toString()}; const until = ${until.toString()};`
