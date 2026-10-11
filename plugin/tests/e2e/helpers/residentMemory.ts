interface MemoryRuntime {
  __abeleExternalMemoryBytes?: () => number | Promise<number>
  process?: { memoryUsage?(): { rss: number } }
  Capacitor?: { Plugins?: { Device?: { getInfo(): Promise<{ memUsed?: number }> } } }
}
/** Self-contained so a live test can serialize it into either renderer. */
export function residentMemorySampler(runtime: MemoryRuntime): (() => Promise<number>) | null {
  if (typeof runtime.__abeleExternalMemoryBytes === 'function')
    return async () => runtime.__abeleExternalMemoryBytes!()
  if (typeof runtime.process?.memoryUsage === 'function')
    return async () => runtime.process!.memoryUsage!().rss
  const device = runtime.Capacitor?.Plugins?.Device
  // The native Device plugin reports the current application's resident bytes on iOS.
  if (typeof device?.getInfo === 'function')
    return async () => Number((await device.getInfo()).memUsed)
  return null
}
