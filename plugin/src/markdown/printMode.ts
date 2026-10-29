import type { InjectionKey } from 'vue'

export const PRINT_MODE: InjectionKey<boolean> = Symbol('abele-print')

/** The host's PDF renderer runs post processors in a hidden `.print` window. */
export function isPrintMode(el: Element): boolean {
  return el.closest('.print') !== null
}
