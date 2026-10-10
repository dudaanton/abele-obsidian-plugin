import type { TokenEngineRuntime } from '../sync/tokenEngineRuntime'
/** Hold one already-received immutable version to exercise a real placement race. */
export function holdTokenDownload(runtime: TokenEngineRuntime, assertCurrent: () => void) {
  const original = runtime.client.versionBytes
  let release!: () => void, blocked!: () => void
  const ready = new Promise<void>((resolve) => {
    blocked = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let once = true
  const wrapped: typeof original = async (...args) => {
    assertCurrent()
    const bytes = await original.apply(runtime.client, args)
    if (once) {
      once = false
      blocked()
      await gate
    }
    assertCurrent()
    return bytes
  }
  runtime.client.versionBytes = wrapped
  return {
    ready,
    release,
    close: () => {
      release()
      if (runtime.client.versionBytes === wrapped) runtime.client.versionBytes = original
    },
  }
}
