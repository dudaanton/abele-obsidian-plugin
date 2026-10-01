import { Modal, Setting } from 'obsidian'
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
export function reviewKeyDestinations(): Modal {
  const modal = new Modal(GlobalStore.getInstance().app)
  modal.setTitle('Review key destinations')
  const render = () => {
    modal.contentEl.empty()
    modal.contentEl.createEl('p', {
      text: 'An address changed outside this device. Keys stay here until you allow the new address. This decision is not synced.',
    })
    const pending = pendingDestinations(AbeleConfig.getInstance())
    if (!pending.length)
      modal.contentEl.createEl('p', { text: 'No destinations need confirmation.' })
    for (const destination of pending) {
      let unencrypted = false
      try {
        checkKeyTransport(destination.origin)
      } catch {
        unencrypted = true
      }
      const setting = new Setting(modal.contentEl)
        .setName(destination.name)
        .setDesc(
          destination.origin +
            (unencrypted ? ' — Unencrypted: anyone on the network path can read the key.' : '')
        )
      if (unencrypted && !canAllowHttp(destination.origin)) {
        setting.setDesc(
          destination.origin + ' — Public HTTP cannot receive keys. Change this address to HTTPS.'
        )
        continue
      }
      setting.addButton((button) =>
        button
          .setButtonText(unencrypted ? 'Allow unencrypted HTTP' : 'Allow on this device')
          .onClick(() => {
            if (unencrypted) allowHttpOrigin(destination.origin)
            acceptDestinations([destination])
            render()
          })
      )
    }
    for (const origin of allowedHttpOrigins()) {
      new Setting(modal.contentEl)
        .setName('HTTP exception')
        .setDesc(origin)
        .addButton((button) =>
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
