import { choiceDialog } from '@/components/obsidian/dialogs'
import type { ConnectionApproval } from './agentAccess'

/** An operation-local grant; never changes the agent's saved Off/Ask/On choice. */
export function connectionApproval(): ConnectionApproval {
  return async (connection, signal) =>
    (await choiceDialog(
      {
        title: 'Allow GitHub connection?',
        message: `Allow this agent operation to use ${connection.name} on ${connection.server || 'github.com'}${connection.account ? ` as ${connection.account.login}` : ''}? Repository content may be sent to the agent's model.`,
        choices: [
          { value: null, text: 'Cancel', tooltip: 'Do not use this GitHub connection' },
          {
            value: 'allow',
            text: 'Allow once',
            tooltip: 'Permit this operation only; keep asking next time',
          },
        ],
      },
      { signal }
    )) === 'allow'
}
