import { onBeforeUnmount, watch } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'

/**
 * Saving a settings screen's edits without losing any, and without overwriting newer ones.
 *
 * `apply` copies the screen's fields into the shared settings, and runs at once on every edit:
 * a plugin reload or another save in the meantime then already carries it. Only the disk write
 * waits, so typing does not write on every key — and closing the screen writes whatever is
 * still waiting rather than dropping it.
 *
 * `reseed` copies the shared settings back into the screen when they change underneath it —
 * sync bringing another device's copy, most often. What was copied at mount is then stale, and
 * the next edit would write it back over what arrived. An edit of the screen's own still
 * waiting to be written is newer than anything that could have arrived, so it is left alone.
 */
export function useSettingsSave(apply: () => void, reseed: () => void) {
  const config = AbeleConfig.getInstance()
  let timer: number | null = null

  // Nobody waits on the write: a failed one, or one landing after the plugin unloaded, is
  // logged rather than left as an unhandled rejection.
  const write = () => {
    config.saveSettings().catch((err) => console.error('[Abele] Failed to save settings', err))
  }

  const save = () => {
    apply()
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      write()
    }, 500)
  }

  onBeforeUnmount(() => {
    if (timer === null) return
    window.clearTimeout(timer)
    timer = null
    write()
  })

  watch(config.version, () => {
    if (timer === null) reseed()
  })

  return { save }
}
