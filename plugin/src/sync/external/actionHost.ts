import type { ExternalFileActions } from './fileActions'

export interface ExternalActionHost {
  actions(connection?: string): ExternalFileActions
  pin(path: string, pinned: boolean): Promise<void>
  hydrate(path: string): Promise<void>
}
export const externalActionsOf = new WeakMap<object, ExternalActionHost>()
