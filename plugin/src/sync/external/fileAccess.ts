import type { App } from 'obsidian'
import { tokenOffloadsOf } from '../tokenOffloadCoordinator'
import { pathCoordinatorOf } from '../pathCoordinator'
import { durableHostOf } from '../hostSyncStorage'
import { readOpeningHistory } from './openingHistory'

export function recordExternalOpening(app: App, path: string): void {
  try {
    const storage = durableHostOf(app)
    if (!storage) {
      console.debug('External opening history record skipped: storage is unavailable')
      return
    }
    const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
    storage.saveLocalStorage('abele-external-last-opened-v1', {
      ...readOpeningHistory(storage),
      [manager.originalPath(path)]: Date.now(),
    })
  } catch (error) {
    // Opening history is bookkeeping; storage failures must never prevent file access.
    console.debug('External opening history record skipped', error)
  }
}

/** Shared content seam: callers authorize their path before asking for bytes. */
export async function prepareExternalFile(app: App, path: string): Promise<string> {
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  const original = manager.originalPath(path)
  await manager.prepare([original])
  return original
}

/** Resolve an absent link against retained identities, never projection text or a guessed URL. */
export function externalLinkPath(app: App, link: string, source = ''): string | null {
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  const paths = manager.files().map((file) => file.path)
  const parts = (source.slice(0, Math.max(0, source.lastIndexOf('/') + 1)) + link).split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (part === '..') normalized.pop()
    else if (part && part !== '.') normalized.push(part)
  }
  const relative = normalized.join('/')
  if (paths.includes(relative)) return relative
  if (paths.includes(link)) return link
  const local = app.metadataCache.getFirstLinkpathDest(link, source)
  if (local) return local.path
  const matching = paths.filter((path) => path.split('/').at(-1) === link)
  return matching.length === 1 ? matching[0] : null
}
