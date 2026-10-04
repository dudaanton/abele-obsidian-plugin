import { ShellModal } from '@/modal/ShellModal'
import { GlobalStore } from '@/stores/GlobalStore'
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
  const approved = await new Promise<boolean>((resolve) => {
    const controller = new AbortController()
    const modal = new ShellModal(GlobalStore.getInstance().app, {
      title: 'Send saved keys?',
      footer: true,
    })
    let sent = false,
      closed = false
    let inFlight: Promise<void> | null = null
    const callerAbort = () => {
      controller.abort(signal?.reason)
      modal.close()
    }
    modal.bodyEl.createEl('p', { text: `${info.names.join(', ')} → ${info.origin}` })
    modal.bodyEl.createEl('p', {
      text: 'This request will substitute the saved values. Key values are never shown here.',
    })
    modal.bodyEl.createEl('p', {
      text: `Allow address and send remembers this address for: ${info.missing.join(', ')}. Later requests with these keys to this address will not ask again on this device. Other devices will still ask to confirm it.`,
    })
    modal.addButton('Cancel', () => modal.close())
    const allow = modal.addButton(
      'Allow address and send',
      () => {
        if (closed || sent || inFlight !== null || controller.signal.aborted) return
        allow.setDisabled(true)
        inFlight = Promise.resolve()
          .then(() =>
            allowSecretRequestOrigins(request, info.bindings, controller.signal, undefined, () => {
              sent = true
            })
          )
          .then(() => {
            if (!closed) modal.close()
          })
          .catch(() => {
            if (!closed && !controller.signal.aborted)
              modal.bodyEl.createEl('p', {
                text: 'Could not save this key permission. Review key destinations and retry; nothing was sent.',
              })
          })
          .finally(() => {
            inFlight = null
            if (!closed) allow.setDisabled(false)
          })
      },
      { cta: true }
    )
    modal.onClose = () => {
      if (closed) return
      closed = true
      signal?.removeEventListener('abort', callerAbort)
      if (!sent) controller.abort()
      // Do not report cancellation settled while its deferred persistence can still grant rights.
      if (!sent && inFlight !== null)
        void inFlight.then(() => {
          resolve(false)
        })
      else resolve(sent)
    }
    signal?.addEventListener('abort', callerAbort, { once: true })
    modal.open()
  })
  signal?.throwIfAborted()
  if (!approved) throw new Error('Saved-key request was not approved')
}
