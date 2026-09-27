/**
 * Lint rules written as scripts.
 *
 * A script whose header says `// @lint` (or `// @lint warning`) is a rule: run once when a lint
 * starts, it gives back `check(note)` — a list of findings, each a message or
 * `{ message, line, fixable }` — and may give back `fix(note)`, the note's whole new text. Either
 * as a returned `{ check, fix }` or as functions of those names declared in the script.
 *
 * The note they are handed is a copy: whatever a script does to it stays with the script.
 */
import type { ParsedScript } from '@/scripting/types'
import type { LintNote, LintRule } from './types'

/** A script rule's id: its name, marked as a script's so it never collides with a built-in. */
export const scriptRuleId = (name: string): string => `script:${name}`

type Check = (note: LintNote) => unknown
type Fix = (note: LintNote) => unknown

const copy = (note: LintNote): LintNote => ({
  ...note,
  lines: [...note.lines],
  frontmatter: note.frontmatter ? structuredClone(note.frontmatter) : null,
})

/** A rule standing in for a script, before it is loaded or when it could not be. */
function describe(script: ParsedScript): Omit<LintRule, 'check' | 'fix'> {
  return {
    id: scriptRuleId(script.meta.name),
    title: script.meta.name,
    description: script.meta.description || 'A rule written as a script.',
    severity: script.meta.lint === 'warning' ? 'warning' : 'error',
    params: [],
    enabledByDefault: true,
    source: { script: script.path },
  }
}

/** The rule as the settings list it: its name and description, nothing run. */
export function scriptRuleStub(script: ParsedScript): LintRule {
  return { ...describe(script), check: () => [] }
}

/**
 * The rule, loaded: the script is run once and what it gives back becomes `check` and `fix`.
 * A script that fails to load, or gives no `check`, is a rule whose every check throws with the
 * reason — which the run reports once, against the rule, and then leaves it out.
 */
export async function loadScriptRule(
  script: ParsedScript,
  define: (path: string) => Promise<unknown>
): Promise<LintRule> {
  const base = describe(script)
  let check: Check | null = null
  let fix: Fix | null = null
  let failure = ''
  try {
    const def = (await define(script.path)) as { check?: unknown; fix?: unknown } | null
    if (def && typeof def.check === 'function') check = def.check as Check
    if (def && typeof def.fix === 'function') fix = def.fix as Fix
    if (!check) failure = 'the script gives back no check(note) function'
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
  }

  const fixer = fix
  return {
    ...base,
    async check(note) {
      if (!check) throw new Error(failure)
      const found = await check(copy(note))
      if (found === undefined || found === null) return []
      return (Array.isArray(found) ? found : [found]) as never
    },
    ...(fixer
      ? {
          async fix(note: LintNote) {
            const out = await fixer(copy(note))
            return typeof out === 'string' ? out : null
          },
        }
      : {}),
  }
}
