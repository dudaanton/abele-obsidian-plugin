import type { InjectionKey } from 'vue'

export const PRINT_MODE: InjectionKey<boolean> = Symbol('abele-print')
export const PRINT_TASKS: InjectionKey<(task: Promise<unknown>) => void> =
  Symbol('abele-print-tasks')

/** The host's PDF renderer runs post processors in a hidden `.print` window. */
export function isPrintMode(el: Element): boolean {
  return el.closest('.print') !== null
}
