import { GlobalStore } from '@/stores/GlobalStore'
import type { ScriptViewModel } from '@/views/ScriptView'

/** A script tab whose script has bound a view to it. */
export type BoundScriptViewTab = ScriptViewModel & { view: NonNullable<ScriptViewModel['view']> }

/**
 * The open script tab a name means, for `inspect_view` and `screenshot` alike.
 *
 * By tab title or script name, exact before partial, case-insensitive. Every open script tab
 * is considered, bound or not: the service knows only the leaves that have a view, and a tab
 * whose script is still running or has failed is exactly the one an agent asks about after
 * writing that script — so a miss names those too, as starting or failed, rather than leaving
 * them out. Naming what is open turns the miss into the answer to the next question anyway.
 */
export function findScriptViewTab(name: string): BoundScriptViewTab {
  // The cast undoes `ref`'s deep unwrapping, which strips the private fields off the `View`
  // class the models hold.
  const models = GlobalStore.getInstance().scriptViews.value as ScriptViewModel[]
  const bound = models.filter((m): m is BoundScriptViewTab => Boolean(m.view))
  const wanted = name.toLowerCase()
  const hit =
    bound.find(
      (m) => m.view.title.toLowerCase() === wanted || m.view.origin.script.toLowerCase() === wanted
    ) ??
    bound.find(
      (m) =>
        m.view.title.toLowerCase().includes(wanted) ||
        m.view.origin.script.toLowerCase().includes(wanted)
    )
  if (hit) return hit

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
