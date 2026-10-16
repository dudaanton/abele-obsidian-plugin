interface HeapStats {
  used_heap_size: number
  total_heap_size: number
  external_memory: number
  number_of_native_contexts: number
  number_of_detached_contexts: number
}

/** Scalar diagnostics only; serializable into the renderer without retaining UI objects.
 * RSS is a footprint, not a retained-heap measurement. Context and heap counts help tell
 * abandoned page realms from native allocations when a scenario repeatedly reloads.
 * Sampling never forces GC, so the scenario's normal memory pressure stays visible.
 */
export function rendererMemory(load: (id: string) => unknown) {
  const heap = (load('node:v8') as { getHeapStatistics(): HeapStats }).getHeapStatistics()
  const memory = (
    load('node:process') as { memoryUsage(): { rss: number; arrayBuffers: number } }
  ).memoryUsage()
  return {
    rss: memory.rss,
    heapUsed: heap.used_heap_size,
    heapTotal: heap.total_heap_size,
    external: heap.external_memory,
    arrayBuffers: memory.arrayBuffers,
    contexts: heap.number_of_native_contexts,
    detachedContexts: heap.number_of_detached_contexts,
  }
}
