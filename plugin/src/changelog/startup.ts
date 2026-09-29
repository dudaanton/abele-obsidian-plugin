import { recordRun, type VersionStore } from './controller'
import type { Range } from './model'

export function startChangelog(
  store: VersionStore,
  running: string,
  onReady: (callback: () => void) => void,
  offer: (range: Range) => () => void
): () => void {
  const range = recordRun(store, running)
  let stopped = false
  let shown = false
  let hide: (() => void) | undefined
  if (range)
    onReady(() => {
      if (stopped || shown) return
      shown = true
      hide = offer(range)
    })
  return () => {
    stopped = true
    hide?.()
  }
}
