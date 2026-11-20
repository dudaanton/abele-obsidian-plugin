import { shallowRef } from 'vue'
import { openComponentDialog, type ComponentDialog } from '@/modal/componentDialog'
import type { ScriptApprovalRequest } from './scriptExecutionGate'
import { sameBinding } from './ScriptProvenance'

export interface ScriptApprovalDialog extends ScriptApprovalRequest {
  id: number
  answer(accepted: boolean): void
  stop(): void
}
export const scriptApprovalDialog = shallowRef<ScriptApprovalDialog | null>(null)
const waiting: ScriptApprovalDialog[] = []
let nextId = 0
const views = new Map<ScriptApprovalDialog, ComponentDialog>()
const runs = new WeakMap<ScriptApprovalDialog, AbortSignal>()

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

/** Explicit manual requests only; newer snapshots supersede matching pending reviews. */
export function showScriptApproval(
  request: ScriptApprovalRequest,
  signal?: AbortSignal,
  onStop?: () => void
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  const pending = [...waiting, ...(scriptApprovalDialog.value ? [scriptApprovalDialog.value] : [])]
  for (const older of pending) {
    if (
      older.path === request.path &&
      older.identity.fileId === request.identity.fileId &&
      sameBinding(older.identity.binding, request.identity.binding)
    )
      older.answer(false)
  }
  return new Promise((resolve) => {
    let settled = false
    const abort = () => dialog.answer(false)
    const dialog: ScriptApprovalDialog = {
      ...request,
      identity: { ...request.identity, binding: { ...request.identity.binding } },
      id: ++nextId,
      stop() {
        if (settled) return
        // Stop the owning execution before resolving its approval promise.
        onStop?.()
        const pending = [
          ...waiting,
          ...(scriptApprovalDialog.value ? [scriptApprovalDialog.value] : []),
        ]
        for (const other of pending)
          if (other === dialog || (signal && runs.get(other) === signal)) other.answer(false)
      },
      answer(accepted) {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        const index = waiting.indexOf(dialog)
        if (index >= 0) waiting.splice(index, 1)
        views.get(dialog)?.close()
        views.delete(dialog)
        runs.delete(dialog)
        if (scriptApprovalDialog.value?.id === dialog.id) {
          scriptApprovalDialog.value = waiting.shift() ?? null
          if (scriptApprovalDialog.value) present(scriptApprovalDialog.value)
        }
        resolve(accepted)
      },
    }
    if (signal) runs.set(dialog, signal)
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
