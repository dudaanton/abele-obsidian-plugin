import type { ExchangeTrace } from '../../../src/sync/exchangeTrace'

/** Holds real I/O briefly for screenshots; always restore it in the case's finally block. */
export function installSyncActivityProbe(
  runtime: { options: { fetch: typeof fetch }; trace: Pick<ExchangeTrace, 'run'> },
  options: { path?: string; holdUploadAfter?: number; maxHoldMs?: number } = {}
) {
  const run = runtime.trace.run,
    invoke = run.bind(runtime.trace),
    fetcher = runtime.options.fetch
  let comparisonTimer: ReturnType<typeof setTimeout> | undefined
  let uploadTimer: ReturnType<typeof setTimeout> | undefined
  let releaseComparison!: () => void, releaseUpload!: () => void
  const comparison = new Promise<void>((resolve) => {
    releaseComparison = resolve
  })
  const upload = new Promise<void>((resolve) => {
    releaseUpload = resolve
  })
  const state = {
    compareReached: false,
    uploadReached: false,
    puts: 0,
    autoReleased: false,
    releaseComparison: () => {
      clearTimeout(comparisonTimer)
      releaseComparison()
    },
    releaseUpload: () => {
      clearTimeout(uploadTimer)
      releaseUpload()
    },
    restore: () => {
      state.releaseComparison()
      state.releaseUpload()
      runtime.trace.run = run
      runtime.options.fetch = fetcher
    },
  }
  // Filesystem adapters resolve delegated methods dynamically. Replacing one would make
  // a captured proxy method delegate back into its replacement in an endless microtask loop.
  runtime.trace.run = async function <T>(
    operation: string,
    work: () => Promise<T>,
    retain?: boolean
  ) {
    const result = await invoke(operation, work, retain)
    if (
      !state.compareReached &&
      operation.startsWith('fs ') &&
      operation.includes('fingerprint') &&
      (!options.path || operation.includes(options.path))
    ) {
      state.compareReached = true
      comparisonTimer = setTimeout(() => {
        state.autoReleased = true
        releaseComparison()
      }, options.maxHoldMs ?? 15000)
      await comparison
    }
    return result
  }
  runtime.options.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (init?.method === 'PUT' && url.includes('/v2/uploads/')) {
      if (++state.puts === (options.holdUploadAfter ?? 100)) {
        state.uploadReached = true
        uploadTimer = setTimeout(() => {
          state.autoReleased = true
          releaseUpload()
        }, options.maxHoldMs ?? 15000)
        await upload
      }
    }
    return fetcher(input, init)
  }
  return state
}
