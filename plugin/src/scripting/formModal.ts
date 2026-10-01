import { GlobalStore } from '@/stores/GlobalStore'
import type { FormField } from './types'

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
  return new Promise((resolve, reject) => {
    const answer = (values: Record<string, string> | null) => {
      signal?.removeEventListener('abort', abort)
      resolve(values)
    }
    const abort = () => {
      // Another run may have opened its own form meanwhile; close only this one's dialog.
      if (store.scriptFormResolve.value === answer) {
        store.scriptFormModalOpened.value = false
        store.scriptFormResolve.value = null
      }
      reject(new Error('Script stopped'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    store.scriptFormFields.value = fields
    store.scriptFormResolve.value = answer
    store.scriptFormModalOpened.value = true
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
