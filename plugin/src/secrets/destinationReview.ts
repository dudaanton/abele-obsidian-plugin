import { Setting } from 'obsidian'
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
  const modal = new ShellModal(GlobalStore.getInstance().app, {
    title: 'Review key destinations',
    footer: true,
  })
  const render = () => {
    modal.bodyEl.empty()
    modal.footerEl!.empty()
    modal.bodyEl.createEl('p', {
      text: 'An address changed outside this device. Keys stay here until you allow the new address. This decision is not synced.',
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
