/** Bound disposable caches without matching another vault's keys. */
export function pruneLocalStorage(
  storage: Storage,
  vaultPrefix: string,
  family: string,
  live: ReadonlySet<string> | undefined,
  budget: number,
  newest?: string
): void {
  const prefix = vaultPrefix + family
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
    (key): key is string => !!key && key.startsWith(prefix)
  )
  if (newest) {
    const index = keys.indexOf(vaultPrefix + newest)
    if (index >= 0) keys.push(...keys.splice(index, 1))
  }
  let size = 0
  for (const key of keys.reverse()) {
    const value = storage.getItem(key) ?? ''
    if ((live && !live.has(key.slice(prefix.length))) || size + key.length + value.length > budget)
      storage.removeItem(key)
    else size += key.length + value.length
  }
}

export function pruneNodePathCaches(app: object, ids: ReadonlySet<string>, newest?: string): void {
  const appId = (app as { appId?: string }).appId
  if (!appId) return
  try {
    pruneLocalStorage(
      window.localStorage,
      appId + '-',
      'abele-node-path-cache:',
      ids,
      65536,
      newest
    )
  } catch (error) {
    console.debug('[Abele node] Path cache cleanup unavailable', error)
  }
}

/** Optional UI preferences only: never use this for grants or recovery evidence. */
export function trimLocalPreference(app: object, family: string, newest?: string): void {
  const appId = (app as { appId?: string }).appId
  if (!appId) return
  try {
    pruneLocalStorage(window.localStorage, appId + '-', family, undefined, 32768, newest)
  } catch (error) {
    console.debug('[Abele] Preference cleanup unavailable', error)
  }
}
