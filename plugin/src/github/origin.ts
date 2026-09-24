/**
 * Where a GitHub web address starts: the configured server's own origin — its scheme and port, as
 * the Server setting names them — for a link to that server, and `https://<host>` for anything
 * else. A link the plugin writes is opened outside Obsidian too, so `https://host/…` for a server
 * at `http://host:8080` would be a link to nowhere.
 */
import { AbeleConfig } from '@/services/AbeleConfig'
import { endpoints, normaliseHost } from './urls'

export function webOrigin(host: string): string {
  const configured = endpoints(AbeleConfig.getInstance().github?.server ?? '')
  const normal = normaliseHost(host)
  if (normal === configured.webHost) return configured.origin
  return `https://${normal}`
}

/** `<origin>/<owner>/<repo>`, each part encoded. */
export const repoWeb = (r: { host: string; owner: string; repo: string }): string =>
  `${webOrigin(r.host)}/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`
