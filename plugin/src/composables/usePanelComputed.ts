import { inject, provide, ref, type Ref } from 'vue'
import { pausedWhileHidden } from '@/helpers/pausedWhileHidden'

const PANEL_ACTIVE = Symbol('active list panel')
export function providePanelActive(active: Ref<boolean>): void {
  provide(PANEL_ACTIVE, active)
}
/** Footer lists have no panel owner and remain live; sidebar descendants share its visibility. */
export function panelComputed<T>(getter: () => T) {
  return pausedWhileHidden(inject<Ref<boolean>>(PANEL_ACTIVE, ref(true)), getter)
}
