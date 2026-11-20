/**
 * The dialog a script from elsewhere is confirmed in: why it waits, what it is, yes or not now.
 *
 * What it shows is the version the index holds — the one that would run — against the last
 * version confirmed on this device when there is one, as one column with what went and what
 * came marked in it (a side-by-side diff has no room on a phone), and the whole file otherwise.
 * Read-only: changing the code here would confirm something nobody reviewed. The dialog is the
 * kit's `ScriptReviewDialog`.
 */
import type { App } from 'obsidian'
import { openDialog } from '@/components/obsidian/dialogs'
import ScriptReviewDialog from '@/components/ScriptReviewDialog.vue'
import type { ParsedScript } from './types'

export type ReviewRequest = (
  | {
      script: ParsedScript
      template?: never
    }
  | {
      template: { path: string; name: string; source: string }
      script?: never
    }
) & {
  /** The text last confirmed at this path, when this device kept it. */
  previous?: string
  /** Refused by where it came from: shown, but there is nothing to confirm. */
  refused?: boolean
}

const pending = new WeakMap<App, Map<string, AbortController>>()

/** Resolves true only when Confirm was pressed; any other way of closing it is a no. */
export function reviewScript(
  app: App,
  request: ReviewRequest,
  signal?: AbortSignal
): Promise<boolean> {
  signal?.throwIfAborted()
  const { script, template, previous, refused } = request
  const key = `${template ? 'template' : 'script'}\0${template?.path ?? script.path}`
  const reviews = pending.get(app) ?? new Map<string, AbortController>()
  pending.set(app, reviews)
  // Superseding is a refusal of the old snapshot, never approval of its bytes.
  reviews.get(key)?.abort()
  const controller = new AbortController()
  reviews.set(key, controller)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  return openDialog<boolean>(
    ScriptReviewDialog,
    {
      kind: template ? 'template' : 'script',
      name: template?.name ?? script.meta.name,
      path: template?.path ?? script.path,
      text: template?.source ?? script.source ?? script.code,
      previous,
      refused,
    },
    { signal: controller.signal }
  )
    .then((answer) => answer === true && !controller.signal.aborted)
    .finally(() => {
      signal?.removeEventListener('abort', abort)
      if (reviews.get(key) === controller) reviews.delete(key)
    })
}
