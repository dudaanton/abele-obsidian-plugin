import { defineComponent, h, ref, nextTick, type Component } from 'vue'
import type { Plugin } from 'obsidian'
import { onPluginLayoutReady } from '@/helpers/pluginLayoutReady'
import { startupStepAsync } from '@/helpers/startupSteps'

/** Restored panes render after registration, just as panes opened by the host after startup do. */
export function deferredWorkspaceUi(component: Component) {
  const ready = ref(false)
  let timer: number | undefined
  let stopped = false
  const stop = () => {
    stopped = true
    window.clearTimeout(timer)
  }
  return {
    root: defineComponent({
      setup: () => () => (ready.value ? h(component) : null),
    }),
    start(plugin: Plugin) {
      plugin.register(stop)
      onPluginLayoutReady(plugin, () => {
        if (stopped) return
        // A microtask would still flush restored panes inside the awaited onload chain.
        timer = window.setTimeout(() => {
          if (stopped) return
          void startupStepAsync('workspace ui', async () => {
            ready.value = true
            await nextTick()
          })
        }, 0)
      })
    },
    stop,
  }
}
