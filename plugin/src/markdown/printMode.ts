import type { InjectionKey } from 'vue'

export const PRINT_MODE: InjectionKey<boolean> = Symbol('abele-print')
export const PRINT_TASKS: InjectionKey<(task: Promise<unknown>) => void> =
  Symbol('abele-print-tasks')

const trustedPrintRoots = new WeakSet<Element>()

/** Propagate an already established export context into a detached render container. */
export function markPrintRoot(el: Element): void {
  trustedPrintRoots.add(el)
}

/** The host's PDF renderer runs post processors in a hidden `.print` window. */
export function isPrintMode(el: Element): boolean {
  for (let root: Element | null = el; root; root = root.parentElement) {
    if (trustedPrintRoots.has(root)) return true
    if (
      root.classList.contains('print') &&
      root.parentElement === root.ownerDocument.body &&
      root.closest('.workspace, .app-container') === null
    )
      return true
  }
  return false
}
