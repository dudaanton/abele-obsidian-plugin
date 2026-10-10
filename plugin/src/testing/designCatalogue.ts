import { createApp, h, type App as VueApp } from 'vue'
import DesignCatalogue from './DesignCatalogue.vue'
import { GlobalStore } from '@/stores/GlobalStore'

import { CATALOGUE_PAGES, type CataloguePage } from './catalogueShape'
export { CATALOGUE_PAGES, CATALOGUE_COMPONENTS, type CataloguePage } from './catalogueShape'
let mounted: VueApp | undefined
let host: HTMLElement | undefined
export function closeDesignCatalogue() {
  mounted?.unmount()
  mounted = undefined
  host?.remove()
  host = undefined
}
/** Only reachable through the fenced test API/command. Fixtures perform no vault writes. */
export function openDesignCatalogue(
  page: CataloguePage = 'index',
  variant: 'inline' | 'stacked' | 'disclosed' = 'disclosed'
) {
  if (!CATALOGUE_PAGES.includes(page)) throw new Error('Unknown catalogue page')
  closeDesignCatalogue()
  const { app } = GlobalStore.getInstance()
  const doc = app.workspace.containerEl.ownerDocument
  host = doc.win.createDiv()
  doc.body.appendChild(host)
  mounted = createApp({
    render: () =>
      h(DesignCatalogue, {
        page,
        variant,
        onClose: closeDesignCatalogue,
        onNavigate: (next: CataloguePage) => openDesignCatalogue(next, variant),
      }),
  })
  mounted.mount(host)
  return { page, variant, synthetic: true }
}
