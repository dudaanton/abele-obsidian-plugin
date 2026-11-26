/** Scalar diagnostics only: never retain DOM nodes, page text or transfer buffers. */
export async function syncPhaseMemory(
  view: Window,
  doc: Document,
  resident?: (() => Promise<number>) & { source?: string }
) {
  // Inspect existing containers only. Calling choices(), store.all(), or IDB getAll()
  // here would allocate another vault-sized inventory while measuring memory.
  const app = Reflect.get(view, 'app')
  const host = app?.plugins?.plugins?.abele?.tokenEngines
  const sets = host?.ui?.itemSets
  const size = (value: unknown): number =>
    value instanceof Map || value instanceof Set
      ? value.size
      : Array.isArray(value)
        ? value.length
        : 0
  let remoteChoices = 0
  if (sets?.choiceCache instanceof Map)
    for (const choices of sets.choiceCache.values()) remoteChoices += size(choices)
  let pickerSources = 0
  let pickerResults = 0
  // A phone has one document; these attributes count the actual rendered source
  // without retaining a Vue component, its props, or a copy of its paths.
  for (const picker of doc.querySelectorAll?.('.abele-share-picker') ?? []) {
    pickerSources += Number((picker as HTMLElement).dataset.sourceCount) || 0
    pickerResults += picker.querySelectorAll('.suggestion-item').length
  }
  const memory = Reflect.get(view.performance, 'memory')
  const used = memory?.usedJSHeapSize
  const total = memory?.totalJSHeapSize
  let canvasPixels = 0
  for (const canvas of Array.from(doc.getElementsByTagName('canvas')))
    canvasPixels += canvas.width * canvas.height
  let residentBytes: number | undefined
  try {
    residentBytes = await resident?.()
  } catch {
    /* Unsupported native measurement. */
  }
  return {
    at: Date.now(),
    timeOrigin: view.performance.timeOrigin,
    webViewLoad: {
      timeOrigin: view.performance.timeOrigin,
      loadId: Reflect.get(view, '__abelePhoneLoadIdentity')?.loadId ?? null,
    },
    held: {
      runtimes: size(host?.live),
      remoteChoiceSets: size(sets?.choiceCache),
      remoteChoices,
      localChoices: size(sets?.localInventory?.choices),
      issuedShares: size(sets?.issued),
      deletePreviews: size(sets?.facts),
      pendingItemSets: size(sets?.pending),
      pickerSources,
      pickerResults,
    },
    heap:
      Number.isFinite(used) && Number.isFinite(total)
        ? { available: true, usedBytes: used, totalBytes: total }
        : { available: false },
    domNodes: doc.getElementsByTagName('*').length,
    canvasPixels,
    resident:
      typeof residentBytes === 'number' && Number.isFinite(residentBytes) && residentBytes > 0
        ? {
            available: true,
            bytes: residentBytes,
            ...(resident?.source ? { source: resident.source } : {}),
          }
        : { available: false },
  }
}
