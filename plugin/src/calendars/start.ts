/**
 * The calendars wired into the running plugin: the cache file beside its settings, the network
 * through `requestUrl`, the keychain for the links and passwords, and the moments they are read.
 */
import { watch } from 'vue'
import { debounce, type Plugin } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from '@/secrets/SecretStore'
import { CalendarService, setCalendars } from './CalendarService'
import { obsidianRequester } from './http'

/** How often the plugin asks whether the refresh interval has passed. */
const TICK_MS = 60 * 1000

export function startCalendars(plugin: Plugin): CalendarService {
  const adapter = plugin.app.vault.adapter
  const dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/abele`
  const path = `${dir}/calendars-cache.json`
  const config = AbeleConfig.getInstance()

  const service = new CalendarService({
    storage: {
      read: async () => ((await adapter.exists(path)) ? adapter.read(path) : null),
      write: (text) => adapter.write(path, text),
    },
    request: obsidianRequester,
    settings: () => config.calendars,
    secret: (id) => secrets().get(id),
  })
  setCalendars(service)

  plugin.app.workspace.onLayoutReady(() => {
    // The kept events first, so the lists fill at once; the network after.
    void service.load().then(() => {
      if (config.calendars.feeds.some((f) => f.enabled)) void service.refresh()
    })
  })

  plugin.registerInterval(
    window.setInterval(() => {
      if (config.calendars.feeds.some((f) => f.enabled) && service.due()) void service.refresh()
    }, TICK_MS)
  )

  // A calendar added, its link or password changed, or one removed: read what changed only.
  const changed = debounce((): void => void service.refreshChanged(), 1500, true)
  const stop = watch([config.version, () => secrets().version.value], () => changed())
  plugin.register(() => {
    stop()
    setCalendars(null)
  })

  return service
}
