import { AbeleConfig } from '@/services/AbeleConfig'

/**
 * Whether `path` names a script: a `.js` file anywhere under the scripts folder.
 *
 * Only the folder is asked, not whether scripts are switched on — a chat linked to a script
 * stays linked while scripts are off, the same as the file itself stays where it is.
 */
export function isScriptPath(path: string): boolean {
  const folder = (AbeleConfig.getInstance().ai.scriptsFolder ?? '').replace(/\/+$/, '')
  if (!folder || !path.endsWith('.js')) return false
  return path.startsWith(`${folder}/`)
}
