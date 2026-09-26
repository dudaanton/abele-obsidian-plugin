/**
 * Gives a property Obsidian's File type, the first time the plugin writes one that is a file —
 * the link from a book's highlights note back to the book. A type already chosen, by the person
 * or before, is left alone. The type lives in the vault's `types.json`, like any chosen by hand.
 */
import type { App } from 'obsidian'

interface TypeManager {
  registeredTypeWidgets?: Record<string, unknown>
  getAssignedWidget?: (key: string) => string | null
  setType?: (key: string, type: string) => Promise<void> | void
}

export function assignFileType(app: App, key: string): void {
  try {
    const manager = (app as unknown as { metadataTypeManager?: TypeManager }).metadataTypeManager
    if (!manager?.setType || !manager.getAssignedWidget || !manager.registeredTypeWidgets?.file)
      return
    if (manager.getAssignedWidget(key)) return
    void Promise.resolve(manager.setType(key, 'file')).catch((err: unknown) =>
      console.debug('[Abele] could not make', key, 'a File property', err)
    )
  } catch (err) {
    console.debug('[Abele] could not make', key, 'a File property', err)
  }
}
