import { uiErrorMessage, UiError, uiMessage } from '@/i18n/streamBErrors'

import DiffWorker from './diff.worker?worker&inline'
import { DiffComputationError, fullDiff, type TextDiff } from './text'

// The worker carries a stable code; catalogs stay in the UI thread.
const failure = (original: string | undefined, code?: string): UiError =>
  new UiError(
    code === 'line-budget'
      ? uiMessage('streamBError.diffLineBudget')
      : code === 'distinct-lines'
        ? uiMessage('streamBError.diffDistinctLines')
        : original !== undefined
          ? uiErrorMessage(new Error(original))
          : uiMessage('streamBError.d9d8914a5e')
  )

/** Large computations can be interrupted, rather than freezing a mobile UI after navigation. */
export function computeDiff(
  before: string,
  after: string,
  signal?: AbortSignal
): Promise<TextDiff> {
  if (signal?.aborted) return Promise.reject(new DOMException('Comparison cancelled', 'AbortError'))
  if (before.length + after.length < 100000) {
    try {
      return Promise.resolve(fullDiff(before, after))
    } catch (error) {
      if (error instanceof DiffComputationError) throw failure(error.message, error.code)
      throw error
    }
  }
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
    worker.onmessage = (
      event: MessageEvent<{ result?: TextDiff; error?: string; code?: string }>
    ) => {
      stop()
      if (event.data.result) resolve(event.data.result)
      else reject(failure(event.data.error, event.data.code))
    }
    worker.onerror = () => {
      stop()
      reject(new UiError(uiMessage('streamBError.c96140e89e')))
    }
    worker.postMessage({ before, after })
  })
}
