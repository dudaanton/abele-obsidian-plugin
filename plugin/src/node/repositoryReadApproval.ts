import { choiceDialog } from '@/components/obsidian/dialogs'
import type { RepositoryReadApproval } from '@/ai/tools/node'

/** Separate owner decision; generic tool approvals cannot grant repository access. */
export function repositoryReadApproval(): RepositoryReadApproval {
  return async (target, signal) =>
    (await choiceDialog(
      {
        title: 'Allow repository reads for this chat?',
        message: `Allow this chat to read project ${target.project} on node ${target.node} (installation ${target.installation}), including its available external worktrees? Repository content may be sent to the chat model and remain in chat history. This permission lasts for this conversation until revoked or the plugin restarts.`,
        choices: [
          { value: null, text: 'Cancel', tooltip: 'Do not let this chat read the project' },
          {
            value: 'allow',
            text: 'Allow this chat',
            cta: true,
            tooltip: 'Let this chat read the project until revoked',
          },
        ],
      },
      { signal }
    )) === 'allow'
}
