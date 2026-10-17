import type { Deployment, ForgeKind } from './model'

/** Normalize before binding a credential, retaining scheme, port and deployment path. */
export function deployment(kind: ForgeKind, address: string): Deployment {
  const input = address.trim()
  if (!input || /[?#\\]/.test(input)) throw new Error('Invalid forge deployment base.')
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`
  const path = absolute.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '')
  if (
    path.split('/').some((part) => {
      try {
        return ['.', '..'].includes(decodeURIComponent(part))
      } catch {
        return true
      }
    })
  )
    throw new Error('Invalid forge deployment path.')
  const url = new URL(absolute)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname)
    throw new Error('Invalid forge deployment base.')
  const webBase = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  const apiBase =
    kind === 'github'
      ? webBase === 'https://github.com'
        ? 'https://api.github.com'
        : `${webBase}/api/v3`
      : `${webBase}/api/${kind === 'gitlab' ? 'v4' : 'v1'}`
  return { kind, webBase, apiBase }
}

export const deploymentKey = (value: Deployment): string =>
  JSON.stringify([value.kind, value.webBase, value.apiBase])

export const authorityKey = (
  value: Deployment,
  connection: string,
  generation: string,
  repository: string,
  revision: string
): string => JSON.stringify([deploymentKey(value), connection, generation, repository, revision])
