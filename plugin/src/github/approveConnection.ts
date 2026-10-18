import { t } from '@/i18n'
import { choiceDialog } from '@/components/obsidian/dialogs'
import type { ConnectionApproval } from './agentAccess'

/** An operation-local grant; never changes the agent's saved Off/Ask/On choice. */
export function connectionApproval(): ConnectionApproval {
  return async (connection, signal) =>
    (await choiceDialog(
      {
        title: t('streamB.reapply.a8ad766dc5'),
        message: t('streamB.allowThisAgentOperationToUseOn.0a3cea', {
          v0: connection.name,
          v1: connection.server || 'github.com',
          v2: connection.account
            ? t('streamBMeta.6464d6bfa2', { account: connection.account.login })
            : '',
        }),
        choices: [
          {
            value: null,
            text: t('streamB.cancel.19766e'),
            tooltip: t('streamB.reapply.bbcda844c9'),
          },
          {
            value: 'allow',
            text: t('streamB.allowOnce.168511'),
            tooltip: t('streamB.permitThisOperationOnlyKeepAskingNext.ca64c2'),
          },
        ],
      },
      { signal }
    )) === 'allow'
}
