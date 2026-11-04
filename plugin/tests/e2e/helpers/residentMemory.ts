interface MemoryRuntime {
  __abeleExternalMemoryBytes?: () => number | Promise<number>
  process?: { memoryUsage?(): { rss: number } }
  Capacitor?: { Plugins?: { Device?: { getInfo(): Promise<{ memUsed?: number }> } } }
}
/** Self-contained so a live test can serialize it into either renderer. */
export function residentMemorySampler(
  runtime: MemoryRuntime
): ((() => Promise<number>) & { source: 'injected' | 'renderer' | 'native-app' }) | null {
  if (typeof runtime.__abeleExternalMemoryBytes === 'function')
    return Object.assign(async () => runtime.__abeleExternalMemoryBytes!(), {
      source: 'injected' as const,
    })
  if (typeof runtime.process?.memoryUsage === 'function')
    return Object.assign(async () => runtime.process!.memoryUsage!().rss, {
      source: 'renderer' as const,
    })
  const device = runtime.Capacitor?.Plugins?.Device
  // The native Device plugin reports the current application's resident bytes on iOS.
  if (typeof device?.getInfo === 'function')
    return Object.assign(async () => Number((await device.getInfo()).memUsed), {
      source: 'native-app' as const,
    })
  return null
}
