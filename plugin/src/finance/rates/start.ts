/**
 * Today's exchange rates wired into the running plugin: the cache file beside its settings (this
 * device only, never synced), the network through `requestUrl`, the two settings, and the moments
 * the table is fetched: at layout-ready when it is not today's, then on a timer that notices the
 * day has changed.
 */
import { watch } from 'vue'
import type { Plugin } from 'obsidian'
import { settingsSlice } from '@/composables/settingsSlice'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { obsidianRequester } from '@/calendars/http'
import { ExchangeRateService } from './ExchangeRateService'
import { exchangeRates } from './exchangeRates'

export const RATES_CACHE_FILE = 'exchange-rates.json'

/** How often the plugin asks whether a fetch is due; the service itself keeps it to once a day. */
const TICK_MS = 10 * 60 * 1000

export function startExchangeRates(plugin: Plugin): ExchangeRateService {
  const adapter = plugin.app.vault.adapter
  const dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/abele`
  const path = `${dir}/${RATES_CACHE_FILE}`
  const config = AbeleConfig.getInstance()

  const service = new ExchangeRateService({
    request: obsidianRequester,
    storage: {
      read: async () => ((await adapter.exists(path)) ? adapter.read(path) : null),
      write: (text) => adapter.write(path, text),
    },
    store: exchangeRates,
    enabled: () => config.fetchExchangeRates,
    wanted: () => {
      const held = new Set<string>()
      const list = GlobalStore.getInstance().accountsList.value
      for (const [, account] of list?.accounts ?? [])
        if (account.currency) held.add(account.currency)
      return [...held]
    },
  })

  // The settings are what the screens read through the store.
  const stop = watch(
    settingsSlice((c) => ({ enabled: c.fetchExchangeRates, display: c.displayCurrency })),
    ({ enabled, display }, before) => {
      exchangeRates.enabled = enabled
      exchangeRates.display = display
      if (before && enabled && !before.enabled && service.due()) void service.refresh()
    },
    { immediate: true }
  )
  exchangeRates.refresh = () => void service.refresh()

  plugin.app.workspace.onLayoutReady(() => {
    void service.load().then(() => {
      if (service.due()) void service.refresh()
    })
  })
  plugin.registerInterval(
    window.setInterval(() => {
      if (service.due()) void service.refresh()
    }, TICK_MS)
  )
  plugin.register(() => {
    stop()
    exchangeRates.refresh = null
  })

  return service
}
