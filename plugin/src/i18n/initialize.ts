import { requestUrl, type Plugin } from 'obsidian'
import { hashes } from 'virtual:abele-i18n'
import { initializeLocale } from './index'
import { resolveLocale } from './core'
import { loadCatalog } from './loader'

/** Load before mounting UI: existing surfaces resolve labels once at mount. */
export async function initializePluginLocale(plugin: Plugin, raw: string): Promise<void> {
  const { language } = resolveLocale(raw)
  initializeLocale('en')
  if (language === 'en') return
  let timeout: number | undefined
  const catalog = await loadCatalog({
    storage: plugin.app.vault.adapter,
    directory: plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`,
    version: plugin.manifest.version,
    language,
    hash: hashes[language],
    request: async (url) => {
      try {
        const response = await Promise.race([
          requestUrl({ url, method: 'GET', throw: false }),
          new Promise<never>((_, reject) => {
            timeout = window.setTimeout(
              () => reject(new Error('Translation download timed out')),
              8000
            )
          }),
        ])
        if (response.status !== 200) throw new Error('Translation download failed')
        return response.text
      } finally {
        window.clearTimeout(timeout)
      }
    },
  })
  initializeLocale(raw, catalog)
}
