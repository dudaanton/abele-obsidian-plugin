import { t } from '@/i18n'
import { choiceDialog } from '@/components/obsidian/dialogs'
import type { RepositoryReadApproval } from '@/ai/tools/node'

/** Separate owner decision; generic tool approvals cannot grant repository access. */
export function repositoryReadApproval(): RepositoryReadApproval {
  return async (target, signal) =>
    (await choiceDialog(
      {
        title: t('streamB.allowRepositoryReadsForThisChat.569319'),
        message: t('streamB.allowThisChatToReadProjectOn.3248fe', {
          v0: String(target.project),
          v1: String(target.node),
          v2: String(target.installation),
        }),
        choices: [
          {
            value: null,
            text: t('streamB.cancel.19766e'),
            tooltip: t('streamB.doNotLetThisChatReadThe.49c47c'),
          },
          {
            value: 'allow',
            text: t('streamB.allowThisChat.845aa9'),
            cta: true,
            tooltip: t('streamB.letThisChatReadTheProjectUntil.d81795'),
          },
        ],
      },
      { signal }
    )) === 'allow'
}
