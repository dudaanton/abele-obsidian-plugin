/**
 * Which script view an agent means by a name.
 *
 * `inspect_view` and `screenshot` both take a tab title or a script name, and both must
 * answer the same way when it matches nothing: by naming what is open, including a tab whose
 * script is still starting or has failed — that one has no view yet and is very often the
 * one being asked about, right after the agent wrote the script.
 */
import { GlobalStore } from '@/stores/GlobalStore'
import type { ScriptViewModel } from '@/views/ScriptView'
import type { View } from '@/scripting/view/View'

export interface ScriptViewHit {
  view: View
  model: ScriptViewModel
}

/**
 * The tab whose title or script is `name`, exact match first, then a substring. The cast
 * undoes `ref`'s deep unwrapping, which strips the private fields off the `View` class the
 * models hold.
 */
export function findScriptView(
  name: string,
  /**
   * Which of several tabs with the same name to take — the same script opened twice, or a
   * tab restored beside a fresh one. `screenshot` wants the one on screen. Without a
   * preference, or when none qualifies, the first wins.
   */
  prefer?: (model: ScriptViewModel) => boolean
): ScriptViewHit {
  const models = GlobalStore.getInstance().scriptViews.value as ScriptViewModel[]
  const open = models.filter((m): m is ScriptViewModel & { view: View } => Boolean(m.view))
  const wanted = name.toLowerCase()
  const matches = (m: { view: View }, exact: boolean) => {
    const title = m.view.title.toLowerCase()
    const script = m.view.origin.script.toLowerCase()
    return exact
      ? title === wanted || script === wanted
      : title.includes(wanted) || script.includes(wanted)
  }
  const pick = (exact: boolean) => {
    const found = open.filter((m) => matches(m, exact))
    return (prefer && found.find(prefer)) ?? found[0]
  }
  const hit = pick(true) ?? pick(false)
  if (hit) return { view: hit.view, model: hit }

  const names =
    models
      .map((m) => {
        if (m.view) return `"${m.view.title}" (${m.view.origin.script})`
        const script = m.saved?.script ?? (m.status.kind === 'live' ? '' : m.status.script)
        if (m.status.kind === 'failed') return `"${script}" (failed: ${m.status.message})`
        return `"${script}" (starting)`
      })
      .join(', ') || 'none'
  throw new Error(`No script view named "${name}". Open: ${names}`)
}
