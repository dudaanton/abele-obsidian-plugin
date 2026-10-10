import { computed, type ComputedRef } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'

/**
 * Settings fields are plain and may be edited in place. Read them on every publication, but
 * publish a new snapshot only when this consumer's fields changed, not on every settings save.
 */
export function settingsSlice<T>(read: (config: AbeleConfig) => T): ComputedRef<T> {
  const config = AbeleConfig.getInstance()
  let key: string | undefined
  let value: T
  let ready = false
  return computed(() => {
    void config.version.value
    const next = read(config)
    const text = JSON.stringify(next)
    if (!ready || text !== key) {
      value = text === undefined ? next : (JSON.parse(text) as T)
      key = text
      ready = true
    }
    return value
  })
}
