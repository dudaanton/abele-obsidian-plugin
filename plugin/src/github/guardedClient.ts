import type { GithubClient } from './client'

/** A capability guard is rechecked for cached reads, every request, and promise completions. */
export function guardedGithubClient(client: GithubClient, assertAccess: () => void): GithubClient {
  return new Proxy(client, {
    get(target, key, receiver) {
      assertAccess()
      const value = Reflect.get(target, key, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        assertAccess()
        const result = value.apply(receiver, args)
        return result && typeof result.then === 'function'
          ? result.then((resolved: unknown) => { assertAccess(); return resolved })
          : result
      }
    },
  })
}
