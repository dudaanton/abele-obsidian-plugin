import type { App } from 'obsidian'
import { ShellModal } from '@/modal/ShellModal'
import type { ConnectionApproval } from './agentAccess'

/** An operation-local grant; never changes the agent's saved Off/Ask/On choice. */
export function connectionApproval(app: App): ConnectionApproval {
  return (connection, signal) =>
    new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false)
        return
      }
      let allowed = false
      const cancel = () => modal.close()
      const modal = new (class extends ShellModal {
        onClose(): void {
          super.onClose()
          signal?.removeEventListener('abort', cancel)
          resolve(allowed)
        }
      })(app, { title: 'Allow GitHub connection?', footer: true })
      modal.bodyEl.createEl('p', {
        cls: 'abele-confirm__message',
        text: `Allow this agent operation to use ${connection.name} on ${connection.server || 'github.com'}${connection.account ? ` as ${connection.account.login}` : ''}? Repository content may be sent to the agent's model.`,
      })
      modal.addButton('Cancel', () => modal.close(), {
        tooltip: 'Do not use this GitHub connection',
      })
      modal.addButton(
        'Allow once',
        () => {
          allowed = true
          modal.close()
        },
        { tooltip: 'Permit this operation only; keep asking next time' }
      )
      signal?.addEventListener('abort', cancel, { once: true })
      modal.open()
    })
}
