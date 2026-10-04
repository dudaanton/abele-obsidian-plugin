import { Setting, type ButtonComponent } from 'obsidian'
import {
  allowKeyRecipient,
  keyConsentError,
  recipientKeys,
  recipientOrigin,
  removeKeyRecipient,
} from './manualConsent'
import { ShellModal } from '@/modal/ShellModal'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { httpOrigin } from './DestinationPolicy'
import {
  acceptDestinations,
  destinationAccepted,
  forgetDestination,
  pendingDestinations,
} from './destinations'
import {
  allowedHttpOrigins,
  allowHttpOrigin,
  canAllowHttp,
  checkKeyTransport,
  forgetHttpOrigin,
} from './keyTransport'

/** One recipient decision, with named-key permissions kept visible rather than only transport exceptions. */
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
    footer: true,
  })
  let address = '',
    choice = '',
    name = '',
    value = '',
    status = '',
    busy = false
  const render = () => {
    if (controller.signal.aborted) return
    modal.bodyEl.empty()
    modal.footerEl!.empty()
    modal.bodyEl.createEl('p', {
      text: 'Choose a key and recipient. Confirmation and HTTP allowance are local to this device.',
    })
    const message = modal.bodyEl.createEl('p', { text: status, attr: { role: 'status' } })
    const keys = recipientKeys()
    const controls: Array<HTMLInputElement | HTMLSelectElement> = []
    let button: ButtonComponent
    const summary = modal.footerEl!.createEl('p')
    const update = () => {
      let origin = '',
        validation = ''
      if (address) {
        try {
          origin = recipientOrigin(address)
        } catch (error) {
          validation = keyConsentError(error)
        }
      }
      const label = choice === 'new' ? name.trim() : keys.find((key) => key.id === choice)?.name
      summary.textContent =
        origin && label
          ? `${label} → ${origin}${canAllowHttp(origin) ? ' — Unencrypted: anyone on the network path can read the key.' : ''}${choice === 'new' ? ' Save this new key in protected storage.' : ''}`
          : validation || 'Choose a saved key and enter the recipient address.'
      button?.setDisabled(busy || !origin || !label || (choice === 'new' && !value))
    }
    new Setting(modal.bodyEl).setName('Saved key').addDropdown((dropdown) => {
      dropdown.selectEl.setAttribute('aria-label', 'Saved key')
      dropdown.addOption('', 'Choose a key')
      for (const key of keys) dropdown.addOption(key.id, key.name || 'Saved key')
      dropdown
        .addOption('new', 'Save a new named key…')
        .setValue(choice)
        .onChange((next) => {
          choice = next
          value = ''
          if (!address && next !== 'new') {
            const known = [
              ...new Set(
                AbeleConfig.getInstance()
                  .ai.secrets.filter((key) => key.keyId === next)
                  .flatMap((key) =>
                    (key.allowedOrigins ?? []).filter((origin) => httpOrigin(origin) === origin)
                  )
              ),
            ]
            if (known.length === 1) address = known[0]
          }
          render()
        })
      controls.push(dropdown.selectEl)
    })
    new Setting(modal.bodyEl).setName('Recipient address').addText((text) => {
      text.inputEl.setAttribute('aria-label', 'Recipient address')
      text
        .setPlaceholder('Recipient URL')
        .setValue(address)
        .onChange((next) => {
          address = next
          update()
        })
      controls.push(text.inputEl)
    })
    if (choice === 'new') {
      new Setting(modal.bodyEl).setName('New key name').addText((text) => {
        text.inputEl.setAttribute('aria-label', 'New key name')
        text.setValue(name).onChange((next) => {
          name = next
          update()
        })
        controls.push(text.inputEl)
      })
      new Setting(modal.bodyEl)
        .setName('New key value')
        .setDesc('Protected storage; saved only when you confirm.')
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
    }
    const run = (work: () => Promise<void>, success: () => void) => {
      if (busy || controller.signal.aborted) return
      busy = true
      message.textContent = ''
      for (const control of controls) control.disabled = true
      button.setDisabled(true)
      void work()
        .then(() => {
          if (!controller.signal.aborted) success()
        })
        .catch((error) => {
          if (!controller.signal.aborted) status = keyConsentError(error)
        })
        .finally(() => {
          busy = false
          render()
        })
    }
    button = modal.addButton(
      'Allow key and address',
      () => {
        const request =
          choice === 'new' ? { address, newKey: { name, value } } : { address, keyId: choice }
        const origin = recipientOrigin(address)
        const label = choice === 'new' ? name.trim() : keys.find((key) => key.id === choice)?.name
        value = ''
        for (const control of controls)
          if (control instanceof HTMLInputElement && control.type === 'password') control.value = ''
        run(
          () => allowKeyRecipient(request, controller.signal),
          () => {
            if (choice === 'new')
              choice =
                AbeleConfig.getInstance().ai.secrets.find((key) => key.name === label)?.keyId ?? ''
            address = origin
            status = `Allowed ${label} → ${origin}. Retry the original script; nothing was sent automatically.`
          }
        )
      },
      { cta: true }
    )
    update()
    const config = AbeleConfig.getInstance()
    const pairs = config.ai.secrets
      .flatMap((key) =>
        (key.allowedOrigins ?? [])
          .filter((origin) => httpOrigin(origin) === origin)
          .map((origin) => ({ keyId: key.keyId, name: key.name, origin }))
      )
      .filter((pair) => !pair.keyId.startsWith('abele-store-key'))
    if (pairs.length) modal.bodyEl.createEl('h3', { text: 'Key permissions' })
    for (const pair of pairs) {
      const row = modal.bodyEl.createDiv({ attr: { 'data-key-destination': 'true' } })
      let allowed = destinationAccepted(pair)
      let blockedTransport = false
      const unencrypted = canAllowHttp(pair.origin)
      try {
        checkKeyTransport(pair.origin)
      } catch {
        allowed = false
        blockedTransport = true
      }
      const setting = new Setting(row)
        .setName(pair.name || 'Saved key')
        .setDesc(
          `${pair.origin} — ${allowed ? 'Allowed on this device' : 'Needs confirmation on this device'}${unencrypted ? ' — Unencrypted: anyone on the network path can read the key.' : ''}`
        )
      // Confirmation and removal stay beside this recipient, including on narrow screens.
      // Native buttons must wrap rather than push the first control and its ring off-screen.
      setting.controlEl.style.flexWrap = 'wrap'
      if (blockedTransport && !unencrypted)
        setting.setDesc(
          pair.origin + ' — Public HTTP cannot receive keys. Change this address to HTTPS.'
        )
      else if (!allowed)
        setting.addButton((b) =>
          b
            .setButtonText(unencrypted ? 'Allow unencrypted HTTP' : 'Allow on this device')
            .onClick(() => {
              run(
                () =>
                  allowKeyRecipient({ keyId: pair.keyId, address: pair.origin }, controller.signal),
                () => {
                  status = `Allowed ${pair.name} → ${pair.origin}. Retry the original script.`
                }
              )
            })
        )
      setting.addButton((b) =>
        b.setButtonText('Remove key permission').onClick(() => {
          run(
            () => removeKeyRecipient(pair.keyId, pair.origin, controller.signal),
            () => {
              status = `Removed ${pair.name} → ${pair.origin}. The saved key and other permissions remain.`
            }
          )
        })
      )
    }
    const pending = pendingDestinations(config).filter(
      (destination) =>
        !pairs.some(
          (pair) => pair.keyId === destination.keyId && pair.origin === destination.origin
        )
    )
    if (pending.length) modal.bodyEl.createEl('h3', { text: 'Service destinations to confirm' })
    for (const destination of pending) {
      let unencrypted = false
      try {
        checkKeyTransport(destination.origin)
      } catch {
        unencrypted = true
      }
      const row = new Setting(modal.bodyEl)
        .setName(destination.name)
        .setDesc(
          destination.origin +
            (unencrypted ? ' — Unencrypted: anyone on the network path can read the key.' : '')
        )
      if (destination.keyId.startsWith('abele-store-key')) {
        row.setDesc('The store key cannot be sent to a recipient.')
        continue
      }
      if (unencrypted && !canAllowHttp(destination.origin)) {
        row.setDesc(
          destination.origin + ' — Public HTTP cannot receive keys. Change this address to HTTPS.'
        )
        continue
      }
      row.addButton((b) =>
        b
          .setButtonText(unencrypted ? 'Allow unencrypted HTTP' : 'Allow on this device')
          .onClick(() => {
            if (busy) return
            const accepted = destinationAccepted(destination)
            const hadHttp = allowedHttpOrigins().includes(destination.origin)
            try {
              if (config.settingsUnreadable) throw new Error('Settings are unreadable')
              acceptDestinations([destination])
              if (unencrypted) allowHttpOrigin(destination.origin)
              status = `Confirmed ${destination.name} → ${destination.origin}.`
            } catch (error) {
              try {
                if (unencrypted && !hadHttp) forgetHttpOrigin(destination.origin)
              } catch {
                /* Continue independent rollback. */
              }
              try {
                if (!accepted) forgetDestination(destination)
              } catch {
                /* Keep reporting failure. */
              }
              status = keyConsentError(error)
            }
            render()
          })
      )
    }
    if (allowedHttpOrigins().length)
      modal.bodyEl.createEl('h3', { text: 'HTTP transport on this device' })
    for (const origin of allowedHttpOrigins())
      new Setting(modal.bodyEl)
        .setName(origin)
        .setDesc('Unencrypted transport only; each key still needs its own recipient permission.')
        .addButton((b) =>
          b.setButtonText('Remove HTTP exception').onClick(() => {
            if (busy) return
            try {
              forgetHttpOrigin(origin)
              status = 'HTTP exception removed. Keys cannot use this unencrypted address.'
            } catch (error) {
              status = keyConsentError(error)
            }
            render()
          })
        )
  }
  render()
  modal.open()
  return modal
}
