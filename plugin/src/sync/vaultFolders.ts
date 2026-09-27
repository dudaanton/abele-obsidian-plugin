import type { DataAdapter } from 'obsidian'
import { EngineError } from '@abele/sync-core'

/** Folders under the vault, made on the way to a file and tidied when the sync empties them. */

/**
 * The folder a file goes in, made if it is not there.
 *
 * One `exists` and one `mkdir`: on the desktop `mkdir` is `fs.mkdir` with `recursive`, so
 * it makes the whole chain, and walking the segments would cost a round trip each for a
 * depth every write reaches. The chain is only walked when the one call did not do it,
 * which is what a host whose `mkdir` makes one folder at a time would look like.
 */
export async function makeParents(adapter: DataAdapter, target: string): Promise<void> {
  const cut = target.lastIndexOf('/')
  if (cut <= 0) return
  const folder = target.slice(0, cut)
  if (await adapter.exists(folder)) return
  const failed = await tryMkdir(adapter, folder)
  if (failed === null) return

  let walked = ''
  for (const segment of folder.split('/')) {
    walked = walked === '' ? segment : `${walked}/${segment}`
    await tryMkdir(adapter, walked)
  }
  if (!(await adapter.exists(folder))) {
    throw new EngineError('io', `cannot create the folder ${folder}`, failed)
  }
}

/** Makes a folder; answers what went wrong, or null when the folder is there afterwards. */
async function tryMkdir(adapter: DataAdapter, folder: string): Promise<unknown> {
  try {
    await adapter.mkdir(folder)
    return null
  } catch (cause) {
    // Two writes into one new folder race; the loser is told it exists, which is what it
    // asked for.
    return (await adapter.exists(folder)) ? null : cause
  }
}

/**
 * The folders above a file the engine has just taken away, removed while that has left them
 * empty — the folder another device renamed or emptied, which Obsidian would otherwise go on
 * showing here, in the file list and in every folder picker. The daemon's rule: only folders
 * that held the file a moment ago, so a folder somebody left empty themselves is never
 * touched; only when the listing shows nothing at all, hidden files included (a `.DS_Store`
 * is enough to keep one); the first folder that is not empty ends the climb. Never the vault
 * itself and never the config folder.
 *
 * Tidying, not syncing: a folder that would not be listed or removed stays, and says so in
 * the console, rather than failing a sync whose files all arrived.
 */
export async function pruneAbove(
  adapter: DataAdapter,
  configDir: string,
  path: string
): Promise<void> {
  const segments = path.split('/').slice(0, -1)
  while (segments.length > 0) {
    const folder = segments.join('/')
    if (folder === configDir) return
    try {
      const listed = await adapter.list(folder)
      if (listed.files.length > 0 || listed.folders.length > 0) return
      // `recursive`, though the folder was just seen empty: Obsidian desktop's `rmdir` is
      // `fs.rm`, which without it refuses every folder, empty ones too (EISDIR), and the
      // mobile adapter removes recursively whatever the flag says.
      await adapter.rmdir(folder, true)
    } catch (error) {
      console.debug(`[abele-sync] left the folder ${folder} in place`, error)
      return
    }
    console.debug(`[abele-sync] removed the folder ${folder}, which the sync emptied`)
    segments.pop()
  }
}
