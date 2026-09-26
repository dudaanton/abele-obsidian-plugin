/**
 * Property types the plugin chooses for a name the person has not typed yet.
 *
 * - A book's highlights note links it back in `file`, which gets Obsidian's File type the first
 *   time the plugin writes one.
 * - `file` and `files` are drawn as file cards out of the box: while the plugin draws properties,
 *   `file` is a File and `files` the plugin's own Files.
 *
 * A type already chosen, by the person or before, is left alone. The type lives in the vault's
 * `types.json`, like any chosen by hand.
 */
import type { App } from 'obsidian'

interface TypeManager {
  registeredTypeWidgets?: Record<string, unknown>
  getAssignedWidget?: (key: string) => string | null
  setType?: (key: string, type: string) => Promise<void> | void
}

/** The property names drawn as file cards without a type chosen for them, and their types. */
export const FILE_KEYS: Record<string, string> = { file: 'file', files: 'files' }

function assignType(app: App, key: string, type: string): void {
  try {
    const manager = (app as unknown as { metadataTypeManager?: TypeManager }).metadataTypeManager
    if (!manager?.setType || !manager.getAssignedWidget || !manager.registeredTypeWidgets?.[type])
      return
    if (manager.getAssignedWidget(key)) return
    void Promise.resolve(manager.setType(key, type)).catch((err: unknown) =>
      console.debug('[Abele] could not make', key, 'a', type, 'property', err)
    )
  } catch (err) {
    console.debug('[Abele] could not make', key, 'a', type, 'property', err)
  }
}

export function assignFileType(app: App, key: string): void {
  assignType(app, key, 'file')
}

/** Gives `file` and `files` their types, where the person has not chosen others. */
export function assignFileKeys(app: App): void {
  for (const [key, type] of Object.entries(FILE_KEYS)) assignType(app, key, type)
}
