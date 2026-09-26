/**
 * Which scripts run when the plugin starts, on which devices, in what order, and with what.
 *
 * A script gets there two ways, as on the toolbar: by its own header (`// @startup`, or
 * `// @startup desktop` / `// @startup mobile`), or by being put there from the script library,
 * which keeps it in `ai.startupScripts` with the devices it runs on. The list runs first, in its
 * own order; the header's follow, by name. A script on both is run once, where the list puts it
 * and on the devices the list names.
 *
 * Nobody is there to fill in a form at startup, so a script is given its own defaults and one
 * that needs a value it has no default for is not run at all.
 *
 * Everything here is pure; `startupRunner.ts` runs what it picks.
 */
import type { ParsedScript, StartupDevices, StartupScript } from './types'

export function startupDevicesFrom(stored: unknown): StartupDevices {
  return stored === 'desktop' || stored === 'mobile' ? stored : 'both'
}

/** The list as stored, made whole: blanks, repeats and anything unreadable dropped. */
export function startupScriptsFrom(stored: unknown): StartupScript[] {
  if (!Array.isArray(stored)) return []
  const out: StartupScript[] = []
  for (const raw of stored) {
    const entry =
      typeof raw === 'string'
        ? { script: raw }
        : raw && typeof raw === 'object'
          ? (raw as { script?: unknown; devices?: unknown })
          : null
    if (!entry || typeof entry.script !== 'string') continue
    const script = entry.script.trim()
    if (!script || out.some((s) => s.script === script)) continue
    out.push({ script, devices: startupDevicesFrom(entry.devices) })
  }
  return out
}

export function runsOn(devices: StartupDevices, mobile: boolean): boolean {
  return devices === 'both' || devices === (mobile ? 'mobile' : 'desktop')
}

/** The scripts this device runs at startup, in the order it runs them. */
export function startupQueue(
  all: ParsedScript[],
  chosen: StartupScript[],
  mobile: boolean
): ParsedScript[] {
  const byName = new Map(all.map((s) => [s.meta.name, s]))
  const listed = new Set(chosen.map((c) => c.script))
  const first = chosen
    .filter((c) => runsOn(c.devices, mobile))
    .map((c) => byName.get(c.script))
    .filter((s): s is ParsedScript => !!s)
  const headed = all
    .filter((s) => s.meta.startup && !listed.has(s.meta.name) && runsOn(s.meta.startup, mobile))
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name))
  return [...first, ...headed]
}

/** Whether a script runs at startup, and by what; null when it does not. */
export function startupPlace(
  script: ParsedScript,
  chosen: StartupScript[]
): 'setting' | 'header' | null {
  if (chosen.some((c) => c.script === script.meta.name)) return 'setting'
  return script.meta.startup ? 'header' : null
}

/** The list with `script` added at its end; unchanged when it is there already. */
export function withStartupScript(
  chosen: StartupScript[],
  script: string,
  devices: StartupDevices = 'both'
): StartupScript[] {
  if (chosen.some((c) => c.script === script)) return chosen
  return [...chosen, { script, devices }]
}

export function withoutStartupScript(chosen: StartupScript[], script: string): StartupScript[] {
  return chosen.filter((c) => c.script !== script)
}

/** The list with the entry at `idx` moved one place up or down; unchanged past either end. */
export function movedStartupScript(
  chosen: StartupScript[],
  idx: number,
  by: -1 | 1
): StartupScript[] {
  const to = idx + by
  if (idx < 0 || idx >= chosen.length || to < 0 || to >= chosen.length) return chosen
  const out = [...chosen]
  ;[out[idx], out[to]] = [out[to], out[idx]]
  return out
}

export function withStartupDevices(
  chosen: StartupScript[],
  script: string,
  devices: StartupDevices
): StartupScript[] {
  return chosen.map((c) => (c.script === script ? { ...c, devices } : c))
}

/**
 * What a startup script is given: its own defaults, as the types they declare. Null when a value
 * it needs has no default — there is no form to ask for it, so the script is not run.
 */
export function startupParams(script: ParsedScript): Record<string, unknown> | null {
  const params: Record<string, unknown> = {}
  for (const p of script.meta.params) {
    if (p.default === undefined) {
      if (p.required) return null
      continue
    }
    if (p.type === 'number') params[p.name] = Number(p.default)
    else if (p.type === 'boolean') params[p.name] = p.default === 'true'
    else params[p.name] = p.default
  }
  return params
}
