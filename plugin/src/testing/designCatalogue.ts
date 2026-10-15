import { h } from 'vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import DesignCatalogue from './DesignCatalogue.vue'
import { GlobalStore } from '@/stores/GlobalStore'

import { CATALOGUE_PAGES, type CataloguePage } from './catalogueShape'
export { CATALOGUE_PAGES, CATALOGUE_COMPONENTS, type CataloguePage } from './catalogueShape'
let mounted: KitMount | undefined
export function closeDesignCatalogue() {
  mounted?.unmount()
  mounted = undefined
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
  const host = doc.win.createDiv()
  doc.body.appendChild(host)
  mounted = mountKit(
    host,
    {
      render: () =>
        h(DesignCatalogue, {
          page,
          variant,
          onClose: closeDesignCatalogue,
          onNavigate: (next: CataloguePage) => openDesignCatalogue(next, variant),
        }),
    },
    null,
    { remove: true }
  )
  return { page, variant, synthetic: true }
}
