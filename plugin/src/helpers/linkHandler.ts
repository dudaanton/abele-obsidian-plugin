import { Notice } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'

/**
 * Handle obsidian://abele-link?name=xxx&param1=val1&param2=val2
 * Finds the link definition by name, resolves the script, and executes it with query params.
 */
export async function handleLinkAction(params: Record<string, string>): Promise<void> {
  const linkName = params.name
  if (!linkName) {
    new Notice('Abele Link: missing "name" parameter')
    return
  }

  const config = AbeleConfig.getInstance()
  const link = config.links.find((l) => l.name === linkName)
  if (!link) {
    new Notice(`Abele Link: no link configured with name "${linkName}"`)
    return
  }

  const service = ScriptService.getInstance()
  const script = service.getAll().find((s) => s.meta.name === link.scriptName)
  if (!script) {
    new Notice(`Abele Link: script "${link.scriptName}" not found`)
    return
  }

  // All query params except "name" are passed to the script
  const scriptParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'name') scriptParams[key] = value
  }

  try {
    const result = await service.execute(script.path, scriptParams)
    if (result?.trim()) {
      new Notice(result.length > 500 ? result.slice(0, 500) + '...' : result, 10000)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    new Notice(`Abele Link error: ${msg}`, 10000)
    console.error(`[Abele Link] Error executing ${link.scriptName}:`, err)
  }
}
