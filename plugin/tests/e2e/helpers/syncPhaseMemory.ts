/** Scalar diagnostics only: never retain DOM nodes, page text or transfer buffers. */
export async function syncPhaseMemory(
  view: Window,
  doc: Document,
  resident?: (() => Promise<number>) & { source?: string }
) {
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
