import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Server test source only: ABELE_SYNC_REPOSITORY defaults to ~/projects/abele-sync.
 * Shared plugin code always comes from the pinned npm SDK, never from this checkout. */
export function locateSyncRepository({ env = process.env, home = homedir() } = {}) {
  const configured = env.ABELE_SYNC_REPOSITORY
  const directory = configured === undefined ? join(home, 'projects/abele-sync') : configured
  const source = directory.startsWith('~/') ? join(home, directory.slice(2)) : resolve(directory)
  if (
    !directory.trim() ||
    !existsSync(join(source, 'packages/server/package.json')) ||
    !existsSync(join(source, 'package-lock.json'))
  )
    throw new Error(
      'Set ABELE_SYNC_REPOSITORY to an existing abele-sync server checkout; expected ' +
        source +
        ' (default: ~/projects/abele-sync). Shared code is supplied by the npm SDK.'
    )
  return source
}
