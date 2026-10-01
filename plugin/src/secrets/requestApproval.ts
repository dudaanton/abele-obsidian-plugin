import { Modal, Setting } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { allowSecretOrigin, secretRequestInfo, type SecretRequest } from '@/ai/tools/secretUtils'
import { checkKeyTransport } from './keyTransport'

/** Each script request asks, even after the address was added to the saved key's list. */
export async function approveScriptKeyRequest(
  request: SecretRequest,
  signal?: AbortSignal
): Promise<void> {
  const info = secretRequestInfo(request)
  if (!info.names.length) return
  signal?.throwIfAborted()
  checkKeyTransport(info.origin)
  const approved = await new Promise<boolean>((resolve) => {
    const modal = new Modal(GlobalStore.getInstance().app)
    let sent = false
    const abort = () => modal.close()
    modal.setTitle('Send saved keys?')
    modal.contentEl.createEl('p', { text: `${info.names.join(', ')} → ${info.origin}` })
    modal.contentEl.createEl('p', {
      text: 'This request will substitute the saved values. Key values are never shown here.',
    })
    if (info.missing.length)
      modal.contentEl.createEl('p', {
        text: `Sending also adds this address to the allowed list for: ${info.missing.join(', ')}. Other devices will still ask to confirm it.`,
      })
    new Setting(modal.contentEl)
      .addButton((button) => button.setButtonText('Cancel').onClick(() => modal.close()))
      .addButton((button) =>
        button
          .setButtonText(info.missing.length ? 'Allow address and send' : 'Send once')
          .setCta()
          .onClick(() => {
            if (signal?.aborted) return
            for (const name of info.missing) allowSecretOrigin(name, request.url)
            sent = true
            modal.close()
          })
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
