import type { App } from 'obsidian'
import { ShellModal } from '@/modal/ShellModal'
import type { RepositoryReadApproval } from '@/ai/tools/node'

/** Separate owner decision; generic tool approvals cannot grant repository access. */
export function repositoryReadApproval(app: App): RepositoryReadApproval {
  return (target, signal) =>
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
      })(app, { title: 'Allow repository reads for this chat?', footer: true })
      modal.bodyEl.createEl('p', {
        text: `Allow this chat to read project ${target.project} on node ${target.node} (installation ${target.installation}), including its available external worktrees? Repository content may be sent to the chat model and remain in chat history. This permission lasts for this conversation until revoked or the plugin restarts.`,
      })
      modal.addButton('Cancel', () => modal.close())
      modal.addButton(
        'Allow this chat',
        () => {
          allowed = true
          modal.close()
        },
        { cta: true }
      )
      signal?.addEventListener('abort', cancel, { once: true })
      modal.open()
    })
}
