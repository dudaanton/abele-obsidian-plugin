import { ShellModal } from '@/modal/ShellModal'
import './destinationReview.css'
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
    // Which keys, and where to: two facts as a settings window lists them, the names and the
    // address in code type; then what pressing Allow means, in one quiet paragraph.
    const facts = modal.bodyEl.createEl('dl', { cls: 'abele-key-request__facts' })
    facts.createEl('dt', { text: info.names.length === 1 ? 'Key' : 'Keys' })
    const keys = facts.createEl('dd')
    for (const name of info.names) keys.createEl('code', { text: name })
    facts.createEl('dt', { text: 'Sent to' })
    facts.createEl('dd').createEl('code', { text: info.origin })
    modal.bodyEl.createEl('p', {
      cls: 'abele-key-request__note',
      text: `The saved values go into the request; they are never shown here. Allowing remembers this address for ${info.missing.join(', ')} on this device, so it will not ask again here. Other devices will still ask.`,
    })
    // One line for a failure, said again in place rather than piled up on every try.
    const failure = modal.bodyEl.createEl('p', {
      cls: 'abele-key-request__error',
      attr: { role: 'alert' },
    })
    failure.hidden = true
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
              failure.setText(
                'Could not save this key permission, so nothing was sent. Check key destinations and try again.'
              )
            if (!closed && !controller.signal.aborted) failure.hidden = false
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
