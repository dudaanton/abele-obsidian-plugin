import { createApp, h, type App as VueApp } from 'vue'
import DesignCatalogue from './DesignCatalogue.vue'
import { GlobalStore } from '@/stores/GlobalStore'

export const CATALOGUE_PAGES = [
  'index',
  'rows',
  'states',
  'details',
  'swatches',
  'images',
  'events',
  'artifact',
  'comment',
  'comment-thread',
  'waiting',
  'controls',
  'navigation',
  'previews',
  'specialized',
  'icon-picker',
  'confirm',
] as const
export type CataloguePage = (typeof CATALOGUE_PAGES)[number]
export const CATALOGUE_COMPONENTS = [
  'Avatar',
  'Badge',
  'Breadcrumbs',
  'Button',
  'Card',
  'CardGrid',
  'Chart',
  'Checkbox',
  'ConfirmModal',
  'DateDivider',
  'Disclosure',
  'Dropdown',
  'EmptyState',
  'EventList',
  'FloatingButton',
  'FoldHeading',
  'Icon',
  'IconPicker',
  'Image',
  'Input',
  'ListRow',
  'ListSectionHeader',
  'Markdown',
  'MetaLine',
  'Modal',
  'NotePicker',
  'PanelResizeHandle',
  'PathLabel',
  'PeriodSelector',
  'QrCode',
  'Quote',
  'RelativeTime',
  'Search',
  'Section',
  'Setting',
  'SheetHeaderActions',
  'SidebarPanel',
  'Slider',
  'SwatchPicker',
  'Table',
  'Tabs',
  'TreeItem',
  'Waveform',
] as const
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
