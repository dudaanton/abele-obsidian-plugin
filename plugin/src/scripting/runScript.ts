import { Notice } from 'obsidian'
import { ScriptService } from './ScriptService'
import type { ParsedScript } from './types'

/**
 * Running a script the way the interface offers it: by the name the script declares, with
 * values gathered somewhere else.
 *
 * Both callers — a deeplink and a button in a note's header — face the same three questions:
 * which script the name refers to, what to pass it once its own defaults are taken into
 * account, and what to tell the user about the outcome. Keeping the answer in one place is
 * what stops a link and a button behaving differently for reasons nobody chose.
 */

/** Finds a script by the name it declares, which is the name the settings screens show. */
export function findScriptByName(name: string): ParsedScript | undefined {
  return ScriptService.getInstance()
    .getAll()
    .find((script) => script.meta.name === name)
}

/**
 * What to pass the script: its own declared defaults, overridden by what was supplied.
 *
 * A supplied value that is empty is not an override — it means "nothing was said here", and
 * the script's default is what should apply. Without that, clearing a field in the settings
 * would silently pass an empty string where the script expected its default.
 */
export function scriptParams(
  script: ParsedScript,
  supplied: Record<string, unknown>
): Record<string, unknown> {
  const params: Record<string, unknown> = {}

  for (const param of script.meta.params) {
    if (param.default !== undefined) params[param.name] = param.default
  }
  for (const [name, value] of Object.entries(supplied)) {
    if (value === '' || value === undefined || value === null) continue
    params[name] = value
  }

  return params
}

/**
 * Runs the named script and reports what happened.
 *
 * `label` opens every message, so a failure says which part of the interface asked for it.
 */
export async function runScriptByName(
  name: string,
  supplied: Record<string, unknown>,
  label = 'Abele'
): Promise<void> {
  const script = findScriptByName(name)
  if (!script) {
    new Notice(`${label}: script "${name}" not found`)
    return
  }

  try {
    const result = await ScriptService.getInstance().execute(
      script.path,
      scriptParams(script, supplied)
    )
    if (result?.trim()) {
      new Notice(result.length > 500 ? result.slice(0, 500) + '...' : result, 10000)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    new Notice(`${label} error: ${msg}`, 10000)
    console.error(`[Abele] Error executing script "${name}":`, err)
  }
}
