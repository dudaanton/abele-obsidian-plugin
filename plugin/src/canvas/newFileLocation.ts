import type { App, TFolder } from 'obsidian'
import { newDocumentParent } from '@/helpers/newDocument'

/** Native Canvas's command and ribbon bypass FileManager and use their own location setting. */
export function canvasNewFileLocation(app: App, enabled: () => boolean): () => void {
  // The native creation seam is not public; keep the patch scoped and restore it on unload.
  const native = (
    app as unknown as {
      internalPlugins?: {
        getEnabledPluginById(id: string): { getNewFileParent: (source?: string) => TFolder } | null
      }
    }
  ).internalPlugins?.getEnabledPluginById('canvas')
  if (!native || typeof native.getNewFileParent !== 'function') return () => {}
  const original = native.getNewFileParent
  let live = true
  const patched = function (this: typeof native, source = ''): TFolder {
    return live && enabled()
      ? newDocumentParent(app, undefined, source)
      : original.call(this, source)
  }
  native.getNewFileParent = patched
  return () => {
    live = false
    if (native.getNewFileParent === patched) native.getNewFileParent = original
  }
}
