import DiffWorker from './diff.worker?worker&inline'
import { fullDiff, type TextDiff } from './text'

/** Large computations can be interrupted, rather than freezing a mobile UI after navigation. */
export function computeDiff(
  before: string,
  after: string,
  signal?: AbortSignal
): Promise<TextDiff> {
  if (signal?.aborted) return Promise.reject(new DOMException('Comparison cancelled', 'AbortError'))
  if (before.length + after.length < 100000) return Promise.resolve(fullDiff(before, after))
  return new Promise((resolve, reject) => {
    const worker = new DiffWorker()
    const stop = () => {
      worker.terminate()
      signal?.removeEventListener('abort', cancel)
    }
    const cancel = () => {
      stop()
      reject(new DOMException('Comparison cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', cancel, { once: true })
    worker.onmessage = (event: MessageEvent<{ result?: TextDiff; error?: string }>) => {
      stop()
      if (event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? 'The diff could not be computed.'))
    }
    worker.onerror = () => {
      stop()
      reject(new Error('The diff worker could not run. Open each side separately.'))
    }
    worker.postMessage({ before, after })
  })
}
