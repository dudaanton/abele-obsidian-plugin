import {
  getCurrentInstance,
  onScopeDispose,
  onUpdated,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'

/** A viewport observer belongs to the element's document, not the plugin's main window. */
export function useOwnerVisibility(
  target: MaybeRefOrGetter<HTMLElement | null | undefined>,
  onVisibility?: (visible: boolean) => void
) {
  const visible = shallowRef(false)
  let element: HTMLElement | null | undefined
  let doc: Document | undefined
  let observer: IntersectionObserver | undefined
  const report = (value: boolean) => {
    visible.value = value
    onVisibility?.(value)
  }
  const observe = () => {
    const next = toValue(target)
    if (element === next && doc === next?.ownerDocument) return
    observer?.disconnect()
    observer = undefined
    element = next
    doc = next?.ownerDocument
    visible.value = false
    if (!next || !doc) return
    const owner = doc
    const win = owner.defaultView
    const Observer = win?.IntersectionObserver
    // Hosts without intersection reporting should keep a visible display live, not frozen.
    if (!Observer) {
      report(true)
      return
    }
    observer = new Observer(
      (entries) => {
        if (element !== next || doc !== owner) return
        const latest = entries.reduce<IntersectionObserverEntry | undefined>(
          (last, entry) => (!last || entry.time >= last.time ? entry : last),
          undefined
        )
        if (latest) report(latest.isIntersecting)
      },
      { root: owner }
    )
    observer.observe(next)
  }
  const stop = watch(() => toValue(target), observe, { immediate: true, flush: 'post' })
  // Teleport can adopt the same node into another document without replacing the template ref.
  if (getCurrentInstance()) onUpdated(observe)
  onScopeDispose(() => {
    stop()
    observer?.disconnect()
    element = undefined
    doc = undefined
  })
  return visible
}
