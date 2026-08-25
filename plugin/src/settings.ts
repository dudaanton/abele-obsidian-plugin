import { App, PluginSettingTab } from 'obsidian'
import AbelePlugin from './main'
import { GlobalStore } from './stores/GlobalStore'

/**
 * Obsidian 1.13 added a declarative settings API (`getSettingDefinitions()`) that makes a
 * plugin's settings searchable from the settings search box. Adopting it means describing every
 * setting as data, and this plugin's settings are a Vue application with its own tabs, cards and
 * editors — the whole UI would have to be rebuilt to fit that shape. Left as it is on purpose;
 * the cost is that Abele's settings are found by opening the tab rather than by searching.
 */
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
