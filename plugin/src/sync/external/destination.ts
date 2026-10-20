import type { App } from 'obsidian'
import { caseKey } from '@abele/sync-sdk/protocol'
import { tokenOffloadsOf } from '../tokenOffloadCoordinator'
import { pathCoordinatorOf } from '../pathCoordinator'

/** Intentional absence still occupies its logical filename, including its parent folders. */
function externalDestinationOccupied(app: App, path: string): boolean {
  const key = caseKey(path)
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  if (manager.originalPath(path) !== path) return true
  return manager.files().some((file) => {
    const original = caseKey(file.path)
    return original === key || original.startsWith(key + '/') || key.startsWith(original + '/')
  })
}
export function assertExternalDestinationAvailable(app: App, path: string): void {
  if (externalDestinationOccupied(app, path))
    throw new Error(`Destination exists as an offloaded file: ${path}. Download it before editing.`)
}
export function logicalPathExists(app: App, path: string): boolean {
  // Suffixing the basename cannot resolve an ancestor that is itself a file.
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  if (manager.files().some((file) => caseKey(path).startsWith(caseKey(file.path) + '/')))
    throw new Error(`Parent is an offloaded file: ${path}. Download it before editing.`)
  return !!app.vault.getAbstractFileByPath(path) || externalDestinationOccupied(app, path)
}
