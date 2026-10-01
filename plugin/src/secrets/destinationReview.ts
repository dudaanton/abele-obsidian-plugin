import { Modal, Setting } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { acceptDestinations, pendingDestinations } from './destinations'

/** A device-local decision, deliberately separate from saving or importing settings. */
export function reviewKeyDestinations(): void {
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
      new Setting(modal.contentEl)
        .setName(destination.name)
        .setDesc(destination.origin)
        .addButton((button) =>
          button.setButtonText('Allow on this device').onClick(() => {
            acceptDestinations([destination])
            render()
          })
        )
    }
  }
  render()
  modal.open()
}
