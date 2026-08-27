import { App, Notice } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { runScriptByName } from '@/scripting/runScript'

/**
 * Handle obsidian://abele?name=xxx&param1=val1&param2=val2
 * Finds the link definition by name and executes a script or Obsidian command.
 */
export async function handleLinkAction(app: App, params: Record<string, string>): Promise<void> {
  const linkName = params.name
  if (!linkName) {
    new Notice('Abele link: missing "name" parameter')
    return
  }

  const config = AbeleConfig.getInstance()
  const link = config.links.find((l) => l.name === linkName)
  if (!link) {
    new Notice(`Abele link: no link configured with name "${linkName}"`)
    return
  }

  if (link.type === 'command') {
    if (!link.commandId) {
      new Notice('Abele link: no command configured')
      return
    }
    try {
      ;(app as any).commands.executeCommandById(link.commandId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      new Notice(`Abele link error: ${msg}`, 10000)
      console.error(`[Abele Link] Error executing command ${link.commandId}:`, err)
    }
    return
  }

  // type === 'script'. `name` and `vault` address the link itself rather than the script, so
  // they are not passed on; everything else in the URL is a parameter.
  const supplied: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'name' && key !== 'vault') supplied[key] = value
  }

  await runScriptByName(link.scriptName, supplied, 'Abele link')
}
