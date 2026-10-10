import type { TokenEngineRuntime } from '../sync/tokenEngineRuntime'
export function tokenSyncProbe(runtime: TokenEngineRuntime, assertCurrent: () => void) {
  let activeDownloads = 0,
    peakDownloads = 0,
    downloadCount = 0,
    verificationCount = 0
  const close = runtime.observeTransport((path, active) => {
    if (active && path.endsWith('/external/verify')) verificationCount++
    if (path.startsWith('/v2/files/') && path.endsWith('/content')) {
      activeDownloads += active ? 1 : -1
      if (active) downloadCount++
      peakDownloads = Math.max(peakDownloads, activeDownloads)
    }
  })
  return {
    assertCurrent,
    close,
    sync: () => runtime.sync(),
    runExclusive: <T>(work: () => Promise<T>) => runtime.engine.runExclusive(work),
    verify: (...args: Parameters<typeof runtime.client.verifyExternalFile>) =>
      runtime.client.verifyExternalFile(...args),
    download: (...args: Parameters<typeof runtime.client.versionBytes>) =>
      runtime.client.versionBytes(...args),
    stats: () => ({ peakDownloads, downloadCount, verificationCount }),
    reset: () => {
      activeDownloads = 0
      peakDownloads = 0
      downloadCount = 0
    },
  }
}
