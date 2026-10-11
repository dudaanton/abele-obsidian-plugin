import type { TokenEngineRuntime } from '../sync/tokenEngineRuntime'
/** Hold one immutable download before placement to exercise a real placement race. */
export function holdTokenDownload(runtime: TokenEngineRuntime, assertCurrent: () => void) {
  // Preserve method identity for restoration; invocation explicitly supplies the client below.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Restore method identity; invoke with apply below.
  const original = runtime.client.versionBytes
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Restore method identity; invoke with apply below.
  const originalOpen = runtime.client.openVersion
  let release!: () => void, blocked!: () => void
  const ready = new Promise<void>((resolve) => {
    blocked = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let once = true
  const hold = async () => {
    if (once) {
      once = false
      blocked()
      await gate
    }
    assertCurrent()
  }
  const wrapped: typeof original = async (...args) => {
    assertCurrent()
    const bytes = await original.apply(runtime.client, args)
    await hold()
    return bytes
  }
  runtime.client.versionBytes = wrapped
  const wrappedOpen: typeof originalOpen =
    originalOpen &&
    (async (...args) => {
      assertCurrent()
      const source = await originalOpen.apply(runtime.client, args)
      try {
        await hold()
        return source
      } catch (error) {
        await source.close()
        throw error
      }
    })
  if (wrappedOpen) runtime.client.openVersion = wrappedOpen
  return {
    ready,
    release,
    close: () => {
      release()
      if (runtime.client.versionBytes === wrapped) runtime.client.versionBytes = original
      if (wrappedOpen && runtime.client.openVersion === wrappedOpen)
        runtime.client.openVersion = originalOpen
    },
  }
}
