// Serialize state copies and deduplicate durable markers across polling and app restarts.
export function serializeErrorObservation(work) {
  let pending
  return () => {
    pending ??= Promise.resolve().then(work).finally(() => { pending = undefined })
    return pending
  }
}

export function createFailureMonitor({ readMarkers, capture }) {
  const seen = new Set()
  let pending
  return {
    poll() {
      if (pending) return pending
      pending = (async () => {
        for (const marker of await readMarkers()) {
          if (!marker) continue
          const key = `${marker.device}:${marker.pid}:${marker.at}`
          if (seen.has(key)) continue
          seen.add(key)
          await capture(marker)
        }
      })().finally(() => { pending = undefined })
      return pending
    },
  }
}
