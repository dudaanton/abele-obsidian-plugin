import { App, Notice } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'

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

  // type === 'script'
  const service = ScriptService.getInstance()
  const script = service.getAll().find((s) => s.meta.name === link.scriptName)
  if (!script) {
    new Notice(`Abele link: script "${link.scriptName}" not found`)
    return
  }

  // Apply param defaults, then override with URL query params
  const scriptParams: Record<string, unknown> = {}
  for (const p of script.meta.params) {
    if (p.default !== undefined) scriptParams[p.name] = p.default
  }
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'name' && key !== 'vault') scriptParams[key] = value
  }

  try {
    const result = await service.execute(script.path, scriptParams)
    if (result?.trim()) {
      new Notice(result.length > 500 ? result.slice(0, 500) + '...' : result, 10000)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    new Notice(`Abele link error: ${msg}`, 10000)
    console.error(`[Abele Link] Error executing ${link.scriptName}:`, err)
  }
}
