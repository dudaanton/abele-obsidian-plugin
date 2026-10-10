/** Give CodeMirror's destroy hooks time to run, with one pending fallback per workspace. */
export function deferredCleanup(cleanup: () => void) {
  let timer = 0
  return {
    schedule() {
      if (timer) return
      timer = window.setTimeout(() => {
        timer = 0
        cleanup()
      }, 500)
    },
    stop() {
      window.clearTimeout(timer)
      timer = 0
    },
  }
}
