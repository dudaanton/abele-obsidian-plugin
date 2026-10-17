/** Shared REST personality; provider identity remains distinct for routing and credentials. */
export function isNativeForge(value: unknown): value is 'forgejo' | 'gitea' {
  return value === 'forgejo' || value === 'gitea'
}
export const nativeLabel = (value: unknown): string => (value === 'gitea' ? 'Gitea' : 'Forgejo')
