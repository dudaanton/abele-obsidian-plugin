import { GlobalStore } from '@/stores/GlobalStore'
import type { FormField } from './types'

interface FormRequest {
  open(): void
}

// The modal belongs to a store (and its root window), not to the script that asks for it.
const queues = new WeakMap<GlobalStore, FormRequest[]>()

/**
 * Put a form on screen and wait for an answer — `null` if it was dismissed.
 *
 * The modal itself is a Vue component mounted once inside the plugin's root, so opening one
 * is writing to the store it watches. Everything that shows a form goes through here: a
 * script asking for its parameters, `form()` inside a script, and the API reference command.
 */
export function showFormModal(
  fields: FormField[],
  _runId?: string,
  signal?: AbortSignal
): Promise<Record<string, string> | null> {
  signal?.throwIfAborted()
  const store = GlobalStore.getInstance()
  const queue = queues.get(store) ?? []
  queues.set(store, queue)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (values: Record<string, string> | null, stopped = false) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      const active = queue[0] === request
      queue.splice(queue.indexOf(request), 1)
      if (active) {
        store.scriptFormModalOpened.value = false
        store.scriptFormResolve.value = null
      }
      if (stopped) reject(new Error('Script stopped'))
      else resolve(values)
      if (active) queue[0]?.open()
    }
    const answer = (values: Record<string, string> | null) => finish(values)
    const abort = () => finish(null, true)
    const request: FormRequest = {
      open: () => {
        store.scriptFormId.value++
        store.scriptFormFields.value = fields
        store.scriptFormResolve.value = answer
        store.scriptFormModalOpened.value = true
      },
    }
    queue.push(request)
    signal?.addEventListener('abort', abort, { once: true })
    if (queue.length === 1) request.open()
  })
}

/**
 * Show markdown to read. Resolves when the modal is closed — there is nothing to answer.
 *
 * `title` names the modal rather than sitting above the text: a block that is the whole
 * contents of a window does not also need a caption inside it.
 */
export async function showMarkdown(text: string, title?: string): Promise<void> {
  await showFormModal([{ name: 'text', label: title ?? '', type: 'markdown', text }])
}
