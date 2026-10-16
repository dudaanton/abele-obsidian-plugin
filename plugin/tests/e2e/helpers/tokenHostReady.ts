/** Read-only startup wait; callers invoke destructive test operations only after readiness. */
export async function tokenHostReady<T>(
  read: () => T | null | undefined,
  timeoutMs: number,
  startupFinished: () => boolean = () => false,
  startupFailure: () => string | undefined = () => undefined
): Promise<T> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const host = read()
    if (host) return host
    const failure = startupFailure()
    if (failure) throw new Error('Token host initialization failed: ' + failure)
    if (startupFinished()) throw new Error('Token host unavailable after plugin startup completed')
    if (Date.now() >= until) throw new Error('Token host startup did not complete')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
export const TOKEN_HOST_READY = `const tokenHostReady = ${tokenHostReady.toString()};`
