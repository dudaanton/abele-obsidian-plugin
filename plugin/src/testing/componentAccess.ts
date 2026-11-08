import {
  getCurrentInstance,
  useTemplateRef,
  watchPostEffect,
  type ComponentInternalInstance,
} from 'vue'

const components = new WeakMap<Element, ComponentInternalInstance>()
const emissions = new WeakMap<
  ComponentInternalInstance,
  { emit: ComponentInternalInstance['emit'] }
>()

/** Keep emission interception effective when production setup captures its emit function. */
export function testComponentEmit<T extends (...args: never[]) => unknown>(emit: T): T {
  const instance = getCurrentInstance()
  const target = { emit: emit as ComponentInternalInstance['emit'] }
  if (instance) emissions.set(instance, target)
  return ((...args: Parameters<T>) => Reflect.apply(target.emit, undefined, args)) as T
}

/** Explicit opt-in for live drivers; no development-only DOM properties are required. */
export function registerTestComponent(element?: () => Element | null | undefined): void {
  const instance = getCurrentInstance()
  const root = element ? undefined : useTemplateRef<Element>('testComponentRoot')
  watchPostEffect((cleanup) => {
    const el = element ? element() : root?.value
    if (!el || !instance) return
    components.set(el, instance)
    cleanup(() => components.delete(el))
  })
}

export function testComponent(element: Element | null | undefined) {
  const instance = element ? components.get(element) : undefined
  if (!instance) return undefined
  return {
    props: instance.props,
    get api() {
      return instance.exposed
    },
    get emit() {
      return emissions.get(instance)?.emit ?? instance.emit
    },
    set emit(value) {
      const target = emissions.get(instance)
      if (target) target.emit = value
      else instance.emit = value
    },
    get appContext() {
      return instance.appContext
    },
    get isMounted() {
      return instance.isMounted
    },
    get isUnmounted() {
      return instance.isUnmounted
    },
  }
}
