import { shallowRef } from 'vue'
import { openComponentDialog, type ComponentDialog } from '@/modal/componentDialog'
import type { ScriptApprovalRequest } from './scriptExecutionGate'

export interface ScriptApprovalDialog extends ScriptApprovalRequest {
  id: number
  answer(accepted: boolean): void
}
export const scriptApprovalDialog = shallowRef<ScriptApprovalDialog | null>(null)
const waiting: ScriptApprovalDialog[] = []
let nextId = 0
const views = new Map<ScriptApprovalDialog, ComponentDialog>()

function present(dialog: ScriptApprovalDialog): void {
  const view = openComponentDialog(
    async () => (await import('@/components/ScriptApprovalModal.vue')).default,
    { request: dialog },
    {
      onClosed: () => dialog.answer(false),
    }
  )
  views.set(dialog, view)
  void view.ready.catch(() => {})
}

/** Explicit manual requests only; concurrent dialogs are queued, never overwritten. */
export function showScriptApproval(
  request: ScriptApprovalRequest,
  signal?: AbortSignal
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const abort = () => dialog.answer(false)
    const dialog: ScriptApprovalDialog = {
      ...request,
      identity: { ...request.identity, binding: { ...request.identity.binding } },
      id: ++nextId,
      answer(accepted) {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        const index = waiting.indexOf(dialog)
        if (index >= 0) waiting.splice(index, 1)
        views.get(dialog)?.close()
        views.delete(dialog)
        if (scriptApprovalDialog.value?.id === dialog.id) {
          scriptApprovalDialog.value = waiting.shift() ?? null
          if (scriptApprovalDialog.value) present(scriptApprovalDialog.value)
        }
        resolve(accepted)
      },
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (scriptApprovalDialog.value) waiting.push(dialog)
    else {
      scriptApprovalDialog.value = dialog
      present(dialog)
    }
  })
}

export function cancelScriptApprovals(): void {
  for (const dialog of [...waiting]) dialog.answer(false)
  scriptApprovalDialog.value?.answer(false)
}
