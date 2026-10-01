import { customRef, onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { createDisplayClock } from '@/helpers/displayClock'

const clocks = new WeakMap<Document, ReturnType<typeof createDisplayClock>>()
function clockFor(doc: Document) {
  let clock = clocks.get(doc)
  if (!clock) {
    const win = doc.defaultView ?? window
    clock = createDisplayClock({
      now: () => Date.now(),
      schedule(callback, delay) {
        const timer = win.setTimeout(callback, delay)
        return () => win.clearTimeout(timer)
      },
    })
    clocks.set(doc, clock)
  }
  return clock
}

/** One clock per window, with no wakeups or reactive updates for hidden consumers. */
export function useDisplayClock(
  precision: 'day' | 'minute' | 'second',
  active: MaybeRefOrGetter<boolean> = true,
  owner: () => Document = () => document,
  phase: MaybeRefOrGetter<number> = 0
) {
  let value = Date.now()
  let running = false
  const key = (time: number) =>
    precision === 'day'
      ? new Date(time).toDateString()
      : Math.floor((time - toValue(phase)) / (precision === 'minute' ? 60_000 : 1000))
  let notify = () => {}
  const update = (now: number) => {
    if (key(value) === key(now)) return
    value = now
    notify()
  }
  const now = customRef<number>((track, trigger) => {
    notify = trigger
    return {
      get() {
        track()
        // A suspended device or wall-clock adjustment may resume between ticks. A consumer
        // reading the clock then gets today's date immediately, without a frame poll.
        if (running && key(value) !== key(Date.now())) value = Date.now()
        return value
      },
      set() {
        /* read-only presentation value */
      },
    }
  })
  const stop = watch(
    [() => toValue(active), owner, () => toValue(phase)],
    ([enabled, doc, offset], _, cleanup) => {
      let unsubscribe: (() => void) | undefined
      const sync = () => {
        unsubscribe?.()
        unsubscribe = undefined
        running = enabled && !doc.hidden
        if (running) {
          unsubscribe = clockFor(doc).subscribe(
            precision === 'second' ? 1000 : 60_000,
            update,
            offset
          )
        }
      }
      doc.addEventListener('visibilitychange', sync)
      sync()
      cleanup(() => {
        running = false
        unsubscribe?.()
        doc.removeEventListener('visibilitychange', sync)
      })
    },
    { immediate: true, flush: 'sync' }
  )
  onScopeDispose(stop)
  return now
}
