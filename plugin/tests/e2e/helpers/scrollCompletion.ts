/** Install before native input; release acknowledgement alone is not scroll completion. */
export function scrollCompletion(el: HTMLElement) {
  const win = el.ownerDocument.defaultView!
  const initiallyScrollable = el.scrollHeight > el.clientHeight
  let released = false
  let ended = false
  let resolve: (() => void) | undefined
  let timer: number | undefined
  const onEnd = () => {
    if (!released) return
    ended = true
    resolve?.()
  }
  el.addEventListener('scrollend', onEnd)
  return {
    releasing() {
      released = true
    },
    async wait() {
      // A viewport without a scroll range cannot emit scrollend for a no-op drag.
      if (ended || (!initiallyScrollable && el.scrollHeight <= el.clientHeight)) return
      await new Promise<void>((done, reject) => {
        resolve = done
        timer = win.setTimeout(() => reject(Error('Native scrollbar drag did not complete')), 1000)
      }).finally(() => {
        win.clearTimeout(timer)
        resolve = undefined
      })
    },
    stop() {
      el.removeEventListener('scrollend', onEnd)
      win.clearTimeout(timer)
    },
  }
}
