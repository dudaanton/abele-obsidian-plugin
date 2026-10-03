import { Setting, type ButtonComponent } from 'obsidian'
import { allowKeyRecipient, recipientKeys, recipientOrigin } from './manualConsent'
import { ShellModal } from '@/modal/ShellModal'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { acceptDestinations, pendingDestinations } from './destinations'
import {
  allowedHttpOrigins,
  allowHttpOrigin,
  canAllowHttp,
  checkKeyTransport,
  forgetHttpOrigin,
} from './keyTransport'

/** A device-local decision, deliberately separate from saving or importing settings. */
export function reviewKeyDestinations(): ShellModal {
  const controller = new AbortController()
  class ConsentModal extends ShellModal {
    close(): void {
      controller.abort()
      for (const input of Array.from(this.bodyEl.querySelectorAll('input'))) input.value = ''
      super.close()
    }
  }
  const modal = new ConsentModal(GlobalStore.getInstance().app, {
    title: 'Review key destinations',
    size: 'tall',
    footer: true,
  })
  let saved = false
  const render = () => {
    modal.bodyEl.empty()
    modal.footerEl!.empty()
    modal.bodyEl.createEl('p', {
      text: 'An address changed outside this device. Keys stay here until you allow the new address. This decision is not synced.',
    })
    if (saved)
      modal.bodyEl.createEl('p', {
        text: 'Key and address allowed. Retry the original script; nothing was sent automatically.',
      })
    const pending = pendingDestinations(AbeleConfig.getInstance())
    if (!pending.length) modal.bodyEl.createEl('p', { text: 'No destinations need confirmation.' })
    for (const destination of pending) {
      let unencrypted = false
      try {
        checkKeyTransport(destination.origin)
      } catch {
        unencrypted = true
      }
      const setting = new Setting(modal.bodyEl)
        .setName(destination.name)
        .setDesc(
          destination.origin +
            (unencrypted ? ' — Unencrypted: anyone on the network path can read the key.' : '')
        )
      if (destination.keyId.startsWith('abele-store-key')) {
        setting.setDesc('The store key cannot be sent to a recipient.')
        continue
      }
      if (unencrypted && !canAllowHttp(destination.origin)) {
        setting.setDesc(
          destination.origin + ' — Public HTTP cannot receive keys. Change this address to HTTPS.'
        )
        continue
      }
      // Keep the recipient beside its pinned action: several keys may need the same choice.
      new Setting(modal.footerEl!).setName(destination.name).addButton((button) =>
        button
          .setButtonText(unencrypted ? 'Allow unencrypted HTTP' : 'Allow on this device')
          .setTooltip(destination.origin)
          .onClick(() => {
            if (unencrypted) allowHttpOrigin(destination.origin)
            acceptDestinations([destination])
            render()
          })
      )
    }
    addRecipientForm(modal, controller.signal, () => {
      saved = true
      render()
    })
    for (const origin of allowedHttpOrigins()) {
      new Setting(modal.bodyEl).setName('HTTP exception').setDesc(origin)
      new Setting(modal.footerEl!).setName(origin).addButton((button) =>
        button.setButtonText('Remove').onClick(() => {
          forgetHttpOrigin(origin)
          render()
        })
      )
    }
  }
  render()
  modal.open()
  return modal
}

function addRecipientForm(modal: ShellModal, signal: AbortSignal, onSaved: () => void): void {
  modal.bodyEl.createEl('h3', { text: 'Allow a key and address' })
  modal.bodyEl.createEl('p', {
    text: 'Choose a saved key, or explicitly save a new named key in protected storage. Only this key and recipient are approved here. Other devices still need confirmation.',
  })
  let address = ''
  let choice = ''
  let name = ''
  let value = ''
  let busy = false
  const keys = recipientKeys()
  const controls: Array<HTMLInputElement | HTMLSelectElement> = []
  const summary = modal.footerEl!.createEl('p')
  const error = modal.bodyEl.createEl('p', { attr: { role: 'status' } })
  let button: ButtonComponent
  const update = () => {
    let origin = ''
    try {
      origin = recipientOrigin(address)
    } catch {
      /* An incomplete field is not consent. */
    }
    const label = choice === 'new' ? name.trim() : keys.find((row) => row.id === choice)?.name
    summary.textContent =
      origin && label
        ? `${label} → ${origin}${canAllowHttp(origin) ? ' — Unencrypted: anyone on the network path can read the key.' : ''}${choice === 'new' ? ' — Save this new key in protected storage and allow this recipient.' : ''}`
        : 'Enter an address and choose the concrete key to approve.'
    button?.setDisabled(busy || !origin || !label || (choice === 'new' && !value))
  }
  new Setting(modal.bodyEl)
    .setName('Recipient address')
    .setDesc('The scheme, host and port are approved; not every address on this network.')
    .addText((text) => {
      text.inputEl.setAttribute('aria-label', 'Recipient address')
      text.setPlaceholder('Recipient URL').onChange((next) => {
        address = next
        update()
      })
      controls.push(text.inputEl)
    })
  const newFields = modal.bodyEl.createDiv()
  newFields.hidden = true
  new Setting(modal.bodyEl).setName('Saved key').addDropdown((dropdown) => {
    dropdown.selectEl.setAttribute('aria-label', 'Saved key')
    dropdown.addOption('', 'Choose a key')
    for (const key of keys)
      dropdown.addOption(key.id, `${key.name} — ${key.uses.join(', ') || 'Saved key'}`)
    dropdown.addOption('new', 'Save a new named key…').onChange((next) => {
      choice = next
      newFields.hidden = next !== 'new'
      if (next !== 'new') {
        value = ''
        for (const input of Array.from(newFields.querySelectorAll('input[type="password"]')))
          (input as HTMLInputElement).value = ''
      }
      update()
    })
    controls.push(dropdown.selectEl)
  })
  // Keep the new-key fields after the picker in both DOM and keyboard order.
  modal.bodyEl.appendChild(newFields)
  new Setting(newFields)
    .setName('New key name')
    .setDesc('An existing name is never overwritten.')
    .addText((text) => {
      text.inputEl.setAttribute('aria-label', 'New key name')
      text.onChange((next) => {
        name = next
        update()
      })
      controls.push(text.inputEl)
    })
  new Setting(newFields)
    .setName('New key value')
    .setDesc(
      'Saved only when you confirm below. The value is kept exactly as entered.'
    )
    .addText((text) => {
      text.inputEl.type = 'password'
      text.inputEl.autocomplete = 'new-password'
      text.inputEl.setAttribute('aria-label', 'New key value')
      text.onChange((next) => {
        value = next
        update()
      })
      controls.push(text.inputEl)
    })
  button = modal.addButton(
    'Allow key and address',
    () => {
      if (busy || signal.aborted) return
      const request =
        choice === 'new' ? { address, newKey: { name, value } } : { address, keyId: choice }
      busy = true
      value = ''
      for (const control of controls) {
        control.disabled = true
        if (control instanceof HTMLInputElement && control.type === 'password') control.value = ''
      }
      error.textContent = ''
      update()
      void allowKeyRecipient(request, signal)
        .then(() => {
          if (!signal.aborted) onSaved()
        })
        .catch(() => {
          if (!signal.aborted)
            error.textContent =
              'Could not save key permission. Check the address, key name and storage, then try again. No new permission was confirmed.'
        })
        .finally(() => {
          busy = false
          for (const control of controls) control.disabled = false
          update()
        })
    },
    { cta: true }
  )
  update()
}
