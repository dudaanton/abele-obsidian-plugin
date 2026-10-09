import { savedNodeTarget, type RepositoryTabTarget } from './state'
import type { RepositoryLocation, RepositoryIdentity, RepositoryRevision } from './source'

export type NodeRepositoryTarget = Extract<RepositoryTabTarget, { provider: 'node' }>
const prefix = 'obsidian://abele-node-repository?target='
/** Links carry only whitelisted resource identities and relative locations, never node endpoints. */
export function nodeRepositoryLink(
  source: RepositoryIdentity,
  location: RepositoryLocation,
  revision?: RepositoryRevision
): string {
  const clean = savedNodeTarget({ sourceTarget: { provider: 'node', source, location, revision } })
  if (!clean) throw new Error('Invalid node repository location')
  return prefix + encodeURIComponent(JSON.stringify(clean))
}
export function parseNodeRepositoryLink(url: string): NodeRepositoryTarget | null {
  if (!url.startsWith(prefix) || url.length > 16384) return null
  try {
    return savedNodeTarget({
      sourceTarget: JSON.parse(decodeURIComponent(url.slice(prefix.length))),
    })
  } catch {
    return null
  }
}
