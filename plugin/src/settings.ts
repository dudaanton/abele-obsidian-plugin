import { App, PluginSettingTab } from 'obsidian'
import AbelePlugin from './main'
import { genid } from './helpers/vueUtils'
import { GlobalStore } from './stores/GlobalStore'

export const SETTINGS_ID_ATTR = 'abele-settings-id'

export class AbeleSettingTab extends PluginSettingTab {
  id: string
  plugin: AbelePlugin

  constructor(app: App, plugin: AbelePlugin) {
    super(app, plugin)
    this.id = genid()
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this

    containerEl.empty()

    containerEl.createDiv({ attr: { [SETTINGS_ID_ATTR]: this.id } })

    GlobalStore.getInstance().settingsTabId.value = this.id
  }

  hide(): void {
    const store = GlobalStore.getInstance()
    if (store.settingsTabId.value === this.id) {
      store.settingsTabId.value = null
    }
    super.hide()
  }
}
