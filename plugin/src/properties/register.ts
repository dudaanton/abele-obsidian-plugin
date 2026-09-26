/**
 * Switches the plugin's drawing of properties on and off with its setting, at once: a change
 * made in the settings or arriving from another device redraws the Properties panels on screen,
 * and unloading the plugin gives Obsidian back its own drawing.
 */
import { watch } from 'vue'
import type { Plugin } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { forgetThumbnails } from './thumbnails'
import { PropertyWidgets, redrawProperties } from './widgets'

export function registerPropertyWidgets(plugin: Plugin): void {
  const widgets = new PropertyWidgets(plugin.app)
  if (!widgets.load()) return
  const config = AbeleConfig.getInstance()

  const sync = (redraw: boolean) => {
    const on = config.propertyWidgets
    if (on === widgets.active) return
    widgets.apply(on)
    if (redraw) redrawProperties(plugin.app)
  }

  sync(false)
  // Drawn once the layout is there: panels already open from the last session were drawn
  // before the plugin loaded.
  plugin.app.workspace.onLayoutReady(() => redrawProperties(plugin.app))
  const stop = watch(
    () => config.version.value,
    () => sync(true)
  )

  plugin.register(() => {
    stop()
    widgets.destroy()
    forgetThumbnails()
    redrawProperties(plugin.app)
  })
}
