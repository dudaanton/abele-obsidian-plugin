import { computed, type ComputedRef, type Ref } from 'vue'

/**
 * A computed that stops following its sources while `visible` is false and keeps returning the
 * last value it produced. While frozen it depends on `visible` alone, so whatever it would have
 * recalculated from — every balance, every day of a chart — can change as often as it likes
 * at no cost. It recalculates once when `visible` turns true again.
 */
export function pausedWhileHidden<T>(visible: Ref<boolean>, getter: () => T): ComputedRef<T> {
  let last: { value: T } | null = null
  return computed(() => {
    if (!visible.value && last) return last.value
    last = { value: getter() }
    return last.value
  })
}
