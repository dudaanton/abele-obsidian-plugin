import { caseKey } from '@abele/sync-sdk/protocol'

// Match configuration sync's four portable plugin files. Everything else is a local
// cache, index, backup or work directory, including stores added in future versions.
const portable = new Set(['data.json', 'manifest.json', 'main.js', 'styles.css'])

export function isDeviceLocalPluginState(path: string, configDir: string): boolean {
  const root = caseKey(`${configDir}/plugins/abele/`)
  const key = caseKey(path)
  if (!key.startsWith(root)) return false
  const relative = key.slice(root.length)
  return relative !== '' && !portable.has(relative)
}
