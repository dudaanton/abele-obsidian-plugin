/**
 * The "Remember cursor position" plugin (https://github.com/dy-sh/obsidian-remember-cursor-position),
 * which does what `notePlaces` does. A person moving over from it keeps the places it saved:
 * they are read once from its file, which holds the same scroll and cursor this plugin saves.
 */
import type { App } from 'obsidian'
import { NotePlaces, type NotePlace } from './store'

export const OTHER_PLUGIN_ID = 'remember-cursor-position'

/** Its file as it saves it: `{ [path]: { cursor?, scroll?, lastModified? } }`. */
export function placesFromRememberCursor(raw: unknown, now: number): Record<string, NotePlace> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const converted: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as { cursor?: unknown; scroll?: unknown; lastModified?: unknown }
    converted[path] = {
      scroll: v.scroll,
      cursor: v.cursor,
      at: typeof v.lastModified === 'number' ? v.lastModified : now,
    }
  }
  return NotePlaces.from(converted).toJSON()
}

/**
 * Its saved places, from wherever its settings say it keeps them; null when there is no such
 * file on this device.
 */
export async function importRememberCursorPlaces(
  app: App
): Promise<Record<string, NotePlace> | null> {
  const adapter = app.vault.adapter
  const dir = `${app.vault.configDir}/plugins/${OTHER_PLUGIN_ID}`
  let file = `${dir}/cursor-positions.json`
  if (await adapter.exists(`${dir}/data.json`)) {
    try {
      const settings = JSON.parse(await adapter.read(`${dir}/data.json`)) as {
        dbFileName?: unknown
      }
      if (typeof settings.dbFileName === 'string' && settings.dbFileName.trim())
        file = settings.dbFileName.trim()
    } catch {
      // Unreadable settings: the default file is tried.
    }
  }
  if (!(await adapter.exists(file))) return null
  return placesFromRememberCursor(JSON.parse(await adapter.read(file)), Date.now())
}
