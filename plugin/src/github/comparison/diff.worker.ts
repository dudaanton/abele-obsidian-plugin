import { fullDiff } from './text'

self.onmessage = (event: MessageEvent<{ before: string; after: string }>) => {
  try {
    self.postMessage({ result: fullDiff(event.data.before, event.data.after) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
