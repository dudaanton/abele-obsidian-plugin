import { GlobalStore } from '@/stores/GlobalStore'
import type { FormField } from './types'
import { openComponentDialog, type ComponentDialog } from '@/modal/componentDialog'

interface FormRequest {
  open(): void
}

// Each request owns its component and answer; the queue preserves the order of presentation.
const queues = new WeakMap<GlobalStore, FormRequest[]>()

/**
 * Put a form on screen and wait for an answer — `null` if it was dismissed.
 *
 * Each queued request loads and mounts a fresh component through the shared dialog host.
 * Everything that shows a form goes through here: script parameters, `form()` and the
 * API reference command. No fields or resolver live in the shared UI store.
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
    let dialog: ComponentDialog | null = null
    const finish = (values: Record<string, string> | null, stopped = false, error?: unknown) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      const active = queue[0] === request
      queue.splice(queue.indexOf(request), 1)
      dialog?.close()
      if (stopped) reject(new Error('Script stopped'))
      else if (error)
        reject(error instanceof Error ? error : new Error('Could not load script form'))
      else resolve(values)
      if (active) queue[0]?.open()
    }
    const answer = (values: Record<string, string> | null) => finish(values)
    const abort = () => finish(null, true)
    const request: FormRequest = {
      open: () => {
        dialog = openComponentDialog(
          async () => (await import('@/components/ScriptFormModal.vue')).default,
          {
            fields,
            resolve: answer,
          },
          { onClosed: (error) => finish(null, false, error) }
        )
        // Import failures settle this request through onClosed and let the queue continue.
        void dialog.ready.catch(() => {})
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
