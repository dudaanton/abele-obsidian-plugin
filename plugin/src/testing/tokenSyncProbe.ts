import type { TokenEngineRuntime } from '../sync/tokenEngineRuntime'
import { retryTransientOperation } from '../sync/transientOperation'
export function tokenSyncProbe(runtime: TokenEngineRuntime, assertCurrent: () => void) {
  let activeDownloads = 0,
    peakDownloads = 0,
    downloadCount = 0,
    verificationCount = 0
  const close = runtime.observeTransport((path, active, successful, rangeOffset) => {
    if (!active && successful && path.endsWith('/external/verify')) verificationCount++
    if (path.startsWith('/v2/files/') && path.endsWith('/content')) {
      activeDownloads += active ? 1 : -1
      // One logical download starts at byte zero; subsequent ranges retain backpressure.
      if (active && (rangeOffset === undefined || rangeOffset === 0)) downloadCount++
      peakDownloads = Math.max(peakDownloads, activeDownloads)
    }
  })
  return {
    assertCurrent,
    close,
    sync: () => retryTransientOperation(() => runtime.sync(), assertCurrent),
    runExclusive: <T>(work: () => Promise<T>) => runtime.engine.runExclusive(work),
    verify: (...args: Parameters<typeof runtime.client.verifyExternalFile>) =>
      retryTransientOperation(() => runtime.client.verifyExternalFile(...args), assertCurrent),
    openVersion: (...args: Parameters<typeof runtime.client.openVersion>) =>
      retryTransientOperation(() => runtime.client.openVersion(...args), assertCurrent),
    download: (...args: Parameters<typeof runtime.client.versionBytes>) =>
      retryTransientOperation(() => runtime.client.versionBytes(...args), assertCurrent),
    stats: () => ({ peakDownloads, downloadCount, verificationCount }),
    reset: () => {
      activeDownloads = 0
      peakDownloads = 0
      downloadCount = 0
    },
  }
}
