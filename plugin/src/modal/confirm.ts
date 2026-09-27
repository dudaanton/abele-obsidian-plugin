import type { App } from 'obsidian'
import { ShellModal } from './ShellModal'

/**
 * The question asked before something is destroyed, for code that is not a Vue component — the
 * kit's `ConfirmModal` in the same shell. Resolves true only when the action was pressed; any
 * other way of closing it is a no.
 */
export function confirmAction(
  app: App,
  options: {
    title: string
    /** What will be lost, named. */
    message: string
    confirmText?: string
    confirmTooltip?: string
  }
): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false
    const modal = new (class extends ShellModal {
      onClose(): void {
        super.onClose()
        resolve(confirmed)
      }
    })(app, { title: options.title, footer: true })
    modal.bodyEl.createEl('p', { text: options.message, cls: 'abele-confirm__message' })
    modal.addButton('Cancel', () => modal.close(), {
      tooltip: 'Close this and change nothing',
    })
    modal.addButton(
      options.confirmText ?? 'Delete',
      () => {
        confirmed = true
        modal.close()
      },
      { warning: true, tooltip: options.confirmTooltip ?? 'Go ahead and delete it' }
    )
    modal.open()
  })
}
