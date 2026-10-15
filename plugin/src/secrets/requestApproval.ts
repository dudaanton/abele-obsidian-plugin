import './destinationReview.css'
import { openDialog } from '@/components/obsidian/dialogs'
import SavedKeyRequestModal from '@/components/settings/SavedKeyRequestModal.vue'
import {
  allowSecretRequestOrigins,
  secretRequestInfo,
  snapshotSecretRequest,
  type SecretRequest,
} from '@/ai/tools/secretUtils'
import { checkKeyTransport } from './keyTransport'

/** Ask only for recipients not yet allowed for every named key on this device. */
export async function approveScriptKeyRequest(
  request: SecretRequest,
  signal?: AbortSignal
): Promise<void> {
  request = snapshotSecretRequest(request)
  const info = secretRequestInfo(request)
  if (!info.names.length) return
  signal?.throwIfAborted()
  checkKeyTransport(info.origin)
  if (!info.missing.length) return
  // Aborted by the caller's signal, which closes the dialog through it, and by any close that
  // comes before the permission was committed, so a save still running stops granting.
  const controller = new AbortController()
  let sent = false
  let inFlight: Promise<void> | null = null
  const callerAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', callerAbort, { once: true })
  const allow = (): Promise<void> => {
    const saving = Promise.resolve().then(() =>
      allowSecretRequestOrigins(request, info.bindings, controller.signal, undefined, () => {
        sent = true
      })
    )
    inFlight = saving.then(
      () => {},
      () => {}
    )
    void inFlight.then(() => {
      inFlight = null
    })
    return saving
  }
  try {
    await openDialog(
      SavedKeyRequestModal,
      { names: info.names, origin: info.origin, missing: info.missing, allow },
      { signal: controller.signal }
    )
  } finally {
    signal?.removeEventListener('abort', callerAbort)
  }
  if (!sent) controller.abort()
  // Do not report cancellation settled while its deferred persistence can still grant rights.
  const approved = sent
  if (!sent && inFlight !== null) await inFlight
  signal?.throwIfAborted()
  if (!approved) throw new Error('Saved-key request was not approved')
}
