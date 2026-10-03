/** Trusted, build-time MapLibre ESM assets. Shared code is stored once, not once per realm. */
export interface MaplibreSources {
  shared: string
  main: string
  worker: string
}
interface WorkerModule {
  setWorkerUrl(url: string): void
}
export interface ModuleHost<T> {
  createUrl(source: string): string
  revokeUrl(url: string): void
  importModule(url: string): Promise<T>
}

export function createMaplibreRuntime<T extends WorkerModule>(
  sources: MaplibreSources,
  host: ModuleHost<T>
) {
  let pending: Promise<T> | null = null
  let generation = 0
  const urls = new Set<string>()
  const revoke = (owned: string[]) => {
    for (const url of owned) if (urls.delete(url)) host.revokeUrl(url)
  }
  const create = (source: string, owned: string[]) => {
    const url = host.createUrl(source)
    urls.add(url)
    owned.push(url)
    return url
  }
  const imports = (source: string, sharedUrl: string) => {
    const marker = /(['"])abele-maplibre-shared\1/g
    if (!marker.test(source)) throw new Error('MapLibre asset does not name the shared module')
    return source.replace(marker, JSON.stringify(sharedUrl))
  }
  return {
    load(): Promise<T> {
      if (pending !== null) return pending
      const started = generation
      const owned: string[] = []
      const loading = (async () => {
        const shared = create(sources.shared, owned)
        const main = create(imports(sources.main, shared), owned)
        const worker = create(imports(sources.worker, shared), owned)
        const module = await host.importModule(main)
        if (generation !== started) throw new Error('Map runtime was disposed')
        module.setWorkerUrl(worker)
        return module
      })()
      const guarded = loading.catch((error) => {
        revoke(owned)
        if (pending === guarded) pending = null
        throw error
      })
      pending = guarded
      return guarded
    },
    dispose(): void {
      generation++
      pending = null
      revoke([...urls])
    },
  }
}
