import { ShellModal } from '@/modal/ShellModal'
import { GlobalStore } from '@/stores/GlobalStore'
import { allowSecretOrigin, secretRequestInfo, type SecretRequest } from '@/ai/tools/secretUtils'
import { checkKeyTransport } from './keyTransport'

/** Ask only for recipients not yet allowed for every named key on this device. */
export async function approveScriptKeyRequest(
  request: SecretRequest,
  signal?: AbortSignal
): Promise<void> {
  const info = secretRequestInfo(request)
  if (!info.names.length) return
  signal?.throwIfAborted()
  checkKeyTransport(info.origin)
  if (!info.missing.length) return
  const approved = await new Promise<boolean>((resolve) => {
    const modal = new ShellModal(GlobalStore.getInstance().app, {
      title: 'Send saved keys?',
      footer: true,
    })
    let sent = false
    const abort = () => modal.close()
    modal.bodyEl.createEl('p', { text: `${info.names.join(', ')} → ${info.origin}` })
    modal.bodyEl.createEl('p', {
      text: 'This request will substitute the saved values. Key values are never shown here.',
    })
    if (info.missing.length)
      modal.bodyEl.createEl('p', {
        text: `Allow address and send remembers this address for: ${info.missing.join(', ')}. Later requests with these keys to this address will not ask again on this device. Other devices will still ask to confirm it.`,
      })
    modal.addButton('Cancel', () => modal.close())
    modal.addButton(
      'Allow address and send',
      () => {
        if (signal?.aborted) return
        for (const name of info.missing) allowSecretOrigin(name, request.url)
        sent = true
        modal.close()
      },
      { cta: true }
    )
    modal.onClose = () => {
      signal?.removeEventListener('abort', abort)
      resolve(sent)
    }
    signal?.addEventListener('abort', abort, { once: true })
    modal.open()
  })
  signal?.throwIfAborted()
  if (!approved) throw new Error('Saved-key request was not approved')
}
