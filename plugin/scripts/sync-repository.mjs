import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

/** Locate the sibling source checkout through Git's common directory, not worktree depth. */
export function syncRepositoryFrom(pluginDirectory, commonDirectory) {
  const checkout = resolve(pluginDirectory, '..')
  return resolve(dirname(resolve(checkout, commonDirectory)), '..', 'abele-sync')
}

export function locateSyncRepository(pluginDirectory) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: resolve(pluginDirectory, '..'),
    encoding: 'utf8',
  }).trim()
  return syncRepositoryFrom(pluginDirectory, common)
}
