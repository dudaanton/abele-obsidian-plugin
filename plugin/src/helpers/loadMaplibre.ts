import assets from 'virtual:maplibre-assets'
import { AbeleConfig } from '@/services/AbeleConfig'
import { createMaplibreRuntime } from './maplibreRuntime'

const runtime = createMaplibreRuntime<typeof import('maplibre-gl')>(assets, {
  createUrl: (source) => URL.createObjectURL(new Blob([source], { type: 'text/javascript' })),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  // These URLs refer exclusively to the library sources embedded by our build, never note text.
  importModule: (url) => import(/* @vite-ignore */ url),
})
const registered = new WeakSet<object>()

/** Map/worker evaluation happens on first use; no second copy of the shared source is stored. */
export async function loadMaplibre(): Promise<typeof import('maplibre-gl')> {
  const plugin = AbeleConfig.getInstance().plugin
  if (plugin && !registered.has(plugin)) {
    registered.add(plugin)
    plugin.register(() => runtime.dispose())
  }
  const module = await runtime.load()
  if (plugin && AbeleConfig.getInstance().plugin !== plugin)
    throw new Error('Map runtime was disposed')
  return module
}
