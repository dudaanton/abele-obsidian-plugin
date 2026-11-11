/** Install before native input; release acknowledgement alone is not scroll completion. */
export function scrollCompletion(el: HTMLElement) {
  const win = el.ownerDocument.defaultView!
  const initiallyScrollable = el.scrollHeight > el.clientHeight
  let released = false
  let ended = false
  let moved = false
  let movedUp = false
  let previousTop = el.scrollTop
  let resolve: (() => void) | undefined
  let timer: number | undefined
  const onScroll = () => {
    const top = el.scrollTop
    if (top !== previousTop) moved = true
    if (top < previousTop) movedUp = true
    previousTop = top
    ended = false
  }
  const onEnd = () => {
    // The last native movement can finish while the mouse is still held. A
    // later movement invalidates it; release itself need not cause a new event.
    if (!released && !moved) return
    ended = true
    resolve?.()
  }
  el.addEventListener('scroll', onScroll)
  el.addEventListener('scrollend', onEnd)
  return {
    get movedUp() {
      return movedUp
    },
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
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', onEnd)
      win.clearTimeout(timer)
    },
  }
}
