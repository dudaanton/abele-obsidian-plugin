import type { GithubClient } from './client'

/** A capability guard is rechecked for cached reads, every request, and promise completions. */
export function guardedGithubClient(
  client: GithubClient,
  assertAccess: () => void,
  allowViewMetadata = false
): GithubClient {
  return new Proxy(client, {
    get(target, key, receiver) {
      // Rendering may inspect non-content metadata even after revocation, so it can show a
      // refusal instead of throwing in Vue's render function. Cache entry points check
      // assertCurrent explicitly; methods and credential-bearing properties remain guarded.
      if (
        allowViewMetadata &&
        ['endpoints', 'cacheNamespace', 'hasToken', 'tokenInfo', 'rate'].includes(String(key))
      )
        return Reflect.get(target, key, target)
      assertAccess()
      const value = Reflect.get(target, key, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        assertAccess()
        const result = value.apply(receiver, args)
        return result && typeof result.then === 'function'
          ? result.then((resolved: unknown) => {
              assertAccess()
              return resolved
            })
          : result
      }
    },
  })
}
