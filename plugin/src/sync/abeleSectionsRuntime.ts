import { computed } from 'vue'
import type { App } from 'obsidian'
import type { AbeleConfig } from '@/services/AbeleConfig'
import type { SecretStore } from '@/secrets/SecretStore'
import { collectEntries, sectionLabel } from '@/transfer/entries'
import { settingsLabel } from '@/i18n/settingsLabels'
import { pageSections } from '@/transfer/pages'
import { openAbeleSettings } from '@/components/settings/settingsTab'
import type { AbeleSectionsSource, KeyStoreState } from './abeleSections'
import { flushHostStorage } from './hostSyncStorage'
import { hostStorageOf } from './hostSyncStorage'
import { SectionSettings } from './abeleSectionEngine'
import { readConnection } from './connection'
import { Platform } from 'obsidian'

export function installSectionSettings(config: AbeleConfig, app: App): void {
  config.sectionSettings = new SectionSettings(
    {
      read: () => hostStorageOf(app).loadLocalStorage('abele-sync-settings-sections-v1'),
      write: (value) =>
        hostStorageOf(app).saveLocalStorage('abele-sync-settings-sections-v1', value),
    },
    readConnection(app).deviceName || (Platform.isMobile ? 'Phone' : 'Computer')
  )
}

export function liveAbeleSections(
  config: AbeleConfig,
  app: App,
  store: SecretStore
): AbeleSectionsSource | null {
  const engine = config.sectionSettings
  if (!engine) return null
  const current = () => {
    void config.version.value
    return config.exportSettings()
  }
  const write = async (next: ReturnType<typeof current>) => {
    await flushHostStorage(app)
    config.editSettings(() => config.applySettings(next))
    await config.saveSettings()
  }
  return {
    rows: computed(() => {
      const entries = collectEntries(current())
      void store.version.value
      return pageSections()
        .filter((id) => engine.ids.includes(id))
        .map((id) => {
          const keys = new Set(
            entries
              .filter((entry) => entry.section === id)
              .flatMap((entry) => entry.secretIds ?? [])
          )
          return {
            id,
            label: settingsLabel(sectionLabel(id)),
            keys: keys.size,
            missing: [...keys].filter((key) => !store.get(key)).length,
            needs: id === 'ai-agents' ? ['ai-providers'] : undefined,
          }
        })
    }),
    chosen: computed(() => {
      void config.version.value
      return engine.chosen
    }),
    kept: computed(() => {
      void config.version.value
      return engine.kept
    }),
    keys: computed<KeyStoreState>(() =>
      store.status.value === 'off' ? 'off' : store.status.value === 'unlocked' ? 'on' : 'locked'
    ),
    differs: async (id) => engine.differs(id, current()),
    choose: async (id, on, take) => write(engine.choose(id, on, current(), take)),
    restore: async (id) => {
      await write(engine.restore(id, current()))
      engine.restored(id)
      await flushHostStorage(app)
      config.version.value++
    },
    openKeys: () => openAbeleSettings(app, 'transfer'),
  }
}
