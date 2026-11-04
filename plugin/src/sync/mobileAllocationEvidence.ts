type Collector = (collected: (size: number) => void) => {
  register(target: object, size: number): void
}

/** Opt-in evidence, never a memory limit. Finalizers may run late: unreclaimed
 * includes garbage awaiting collection, not just objects retained by callers. */
export function allocationEvidence(factory: Collector | null) {
  const seen = new WeakSet<object>()
  let allocatedBytes = 0,
    collectedBytes = 0,
    nativePendingBytes = 0,
    nativePeakBytes = 0
  const registry = factory?.((size) => {
    collectedBytes += size
  })
  return {
    track(buffer: ArrayBufferLike) {
      if (seen.has(buffer)) return
      seen.add(buffer)
      allocatedBytes += buffer.byteLength
      registry?.register(buffer, buffer.byteLength)
    },
    submit(size: number) {
      nativePendingBytes += size
      nativePeakBytes = Math.max(nativePeakBytes, nativePendingBytes)
      let finished = false
      return () => {
        if (finished) return
        finished = true
        nativePendingBytes -= size
      }
    },
    snapshot: () => ({
      collectionAvailable: !!registry,
      allocatedBytes,
      collectedBytes,
      unreclaimedBytes: registry ? allocatedBytes - collectedBytes : null,
      nativePendingBytes,
      nativePeakBytes,
    }),
  }
}

let evidence: ReturnType<typeof allocationEvidence> | undefined
export function startMobileAllocationEvidence(): void {
  evidence ??= allocationEvidence(
    typeof FinalizationRegistry === 'function'
      ? (collected) => new FinalizationRegistry<number>(collected)
      : null
  )
}
export const trackMobileAllocation = (buffer: ArrayBufferLike): void => evidence?.track(buffer)
export const submittedMobileAllocation = (size: number) => evidence?.submit(size)
export function stopMobileAllocationEvidence(): void {
  evidence = undefined
}
export function mobileAllocationSnapshot() {
  const host = window as unknown as {
    performance?: { memory?: { usedJSHeapSize?: number } }
    Capacitor?: { isLoggingEnabled?: boolean }
  }
  const heap = host.performance?.memory?.usedJSHeapSize
  return {
    enabled: !!evidence,
    ...evidence?.snapshot(),
    jsHeapBytes: typeof heap === 'number' && Number.isFinite(heap) ? heap : null,
    bridgeLogging: host.Capacitor?.isLoggingEnabled ?? null,
  }
}
