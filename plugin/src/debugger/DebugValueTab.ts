import { ItemView, Notice, type Plugin, type WorkspaceLeaf } from 'obsidian'
import { createApp, h, reactive, type App as VueApp } from 'vue'
import DebugValueView from '@/components/debugger/DebugValueView.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { GlobalStore } from '@/stores/GlobalStore'

export const DEBUG_VALUE_VIEW_TYPE = 'abele-debug-value'

/** Retained observations live only in this tab, never in the saved workspace layout. */
export class DebugValueTab extends ItemView {
  private vue?: VueApp
  private available = false
  private readonly model = reactive<{
    name: string
    value: string
    type?: string
    mode: 'formatted' | 'raw'
    wrap: boolean
  }>({
    name: 'Debug value',
    value: '',
    type: undefined,
    mode: 'formatted',
    wrap: false,
  })

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.addAction('braces', 'Toggle raw value', () => {
      this.model.mode = this.model.mode === 'raw' ? 'formatted' : 'raw'
    })
    this.addAction('wrap-text', 'Toggle line wrapping', () => {
      this.model.wrap = !this.model.wrap
    })
    this.addAction('copy', 'Copy raw value', () => {
      if (this.available)
        void navigator.clipboard.writeText(this.model.value).catch((e) => {
          console.debug('[debugger] Value copy failed', e)
          new Notice('Could not copy the debug value')
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
      ? createApp({ render: () => h(DebugValueView, { ...this.model }) })
      : createApp(EmptyState, { text: 'Value unavailable. Open it again from the debugger.' })
    this.vue.mount(this.contentEl)
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
