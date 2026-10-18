import { t } from '@/i18n'
import { ItemView, Notice, type Plugin, type WorkspaceLeaf } from 'obsidian'
import { h, reactive } from 'vue'
import DebugValueView from '@/components/debugger/DebugValueView.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import { GlobalStore } from '@/stores/GlobalStore'

export const DEBUG_VALUE_VIEW_TYPE = 'abele-debug-value'

/** Retained observations live only in this tab, never in the saved workspace layout. */
export class DebugValueTab extends ItemView {
  private vue?: KitMount
  private available = false
  private readonly model = reactive<{
    name: string
    value: string
    type?: string
    mode: 'formatted' | 'raw'
    wrap: boolean
  }>({
    name: t('streamC.399df71222a9aa22'),
    value: '',
    type: undefined,
    mode: 'formatted',
    wrap: false,
  })

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.addAction('braces', t('streamC.ebe86e6f444bdd2c'), () => {
      this.model.mode = this.model.mode === 'raw' ? 'formatted' : 'raw'
    })
    this.addAction('wrap-text', t('streamC.e4a9d8818437be3e'), () => {
      this.model.wrap = !this.model.wrap
    })
    this.addAction('copy', t('streamC.15780ff7783d4ecb'), () => {
      if (this.available)
        void navigator.clipboard.writeText(this.model.value).catch((e) => {
          console.debug('[debugger] Value copy failed', e)
          new Notice(t('streamC.1a74d0457855c3b0'))
        })
    })
  }
  getViewType() {
    return DEBUG_VALUE_VIEW_TYPE
  }
  getDisplayText() {
    return this.model.name
  }
  getIcon() {
    return 'braces'
  }
  show(name: string, value: string, type?: string) {
    Object.assign(this.model, { name, value, type })
    this.available = true
    ;(this as unknown as { titleEl?: HTMLElement }).titleEl?.replaceChildren(name)
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
    this.draw()
  }
  private draw() {
    this.vue?.unmount()
    this.contentEl.replaceChildren()
    this.vue = this.available
      ? mountKit(this.contentEl, { render: () => h(DebugValueView, { ...this.model }) })
      : mountKit(this.contentEl, EmptyState, {
          text: t('streamC.0d0317057c562796'),
        })
  }
  async onOpen() {
    this.draw()
  }
  async onClose() {
    this.vue?.unmount()
    this.vue = undefined
    this.available = false
    this.model.value = ''
  }
}

export function registerDebugValues(plugin: Plugin) {
  plugin.registerView(DEBUG_VALUE_VIEW_TYPE, (leaf) => new DebugValueTab(leaf))
}

export async function openDebugValue(name: string, value: string, type?: string) {
  const { workspace } = GlobalStore.getInstance().app
  const leaf = workspace.getLeaf('split', 'vertical')
  await leaf.setViewState({ type: DEBUG_VALUE_VIEW_TYPE, active: true })
  if (leaf.view instanceof DebugValueTab) leaf.view.show(name, value, type)
  await workspace.revealLeaf(leaf)
}
