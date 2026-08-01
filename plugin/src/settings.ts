import { App, PluginSettingTab } from 'obsidian'
import AbelePlugin from './main'
import { GlobalStore } from './stores/GlobalStore'

export class AbeleSettingTab extends PluginSettingTab {
  plugin: AbelePlugin
  private container: HTMLElement | null = null

  constructor(app: App, plugin: AbelePlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this

    containerEl.empty()

    // Since 1.13 settings may live in a separate window with its own document,
    // so the Vue app teleports into this element directly — a CSS selector would
    // only ever be resolved against the main window document.
    this.container = containerEl.createDiv()

    GlobalStore.getInstance().settingsContainer.value = this.container
  }

  hide(): void {
    const store = GlobalStore.getInstance()
    if (store.settingsContainer.value === this.container) {
      store.settingsContainer.value = null
    }
    this.container = null
    super.hide()
  }
}
