import { sha256, type StateStore } from '@abele/sync-core'
import type { App, CachedMetadata } from 'obsidian'
import type { LinkFact } from './LinkSnapshotStore'
export interface CacheObservation {
  path: string
  source: string
  cacheJson: string
  sha: string
  cacheSha: string
  generation: string
  facts: LinkFact[]
}
/** Copy the supported changed(data, cache) callback before any asynchronous identity lookup. */
export async function observeLinks(
  app: App,
  state: StateStore,
  path: string,
  source: string,
  cache: CachedMetadata
): Promise<CacheObservation> {
  const snapshot = JSON.parse(JSON.stringify(cache)) as CachedMetadata
  const cacheJson = JSON.stringify(snapshot)
  const facts: LinkFact[] = []
  for (const { f, kind } of [
    ...(snapshot.links ?? []).map((f) => ({ f, kind: 'link' as const })),
    ...(snapshot.embeds ?? []).map((f) => ({ f, kind: 'embed' as const })),
  ]) {
    const start = f.position.start.offset,
      end = f.position.end.offset
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > source.length ||
      source.slice(start, end) !== f.original
    )
      throw new Error('Native cache callback offsets differ from bytes')
    const resolved = app.metadataCache.getFirstLinkpathDest(f.link, path)
    facts.push({
      kind,
      spelling: f.link,
      original: f.original,
      start,
      end,
      resolvedPath: resolved?.path ?? null,
      targetId: null,
      resolution: resolved ? 'resolved' : 'unresolved',
    })
  }
  for (const f of facts)
    if (f.resolvedPath) f.targetId = (await state.get(f.resolvedPath))?.fileId ?? null
  return {
    path,
    source,
    cacheJson,
    facts,
    sha: await sha256(new TextEncoder().encode(source)),
    cacheSha: await sha256(new TextEncoder().encode(cacheJson)),
    generation: crypto.randomUUID(),
  }
}
