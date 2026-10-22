import type { PathTarget } from './NodePathModel'
import type { NodeErrorAction } from './errorState'
import { NodeService } from './NodeService'
import { GlobalStore } from '@/stores/GlobalStore'
import { openAbeleSettings } from '@/components/settings/settingsTab'
import { openExternal } from '@/helpers/openExternal'
import { nodeAdvertisesMethod } from './advertisedMethods'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { t } from '@/i18n'

export async function recoverNodeError(
  action: NodeErrorAction,
  registrationId?: string,
  target?: PathTarget
): Promise<void> {
  if (action === 'update' || action === 'install') {
    openExternal('https://github.com/dudaanton/abele-node/blob/main/docs/install.md')
    return
  }
  if (action === 'settings') {
    openAbeleSettings(GlobalStore.getInstance().app, 'nodes')
    return
  }
  if (action === 'pair') {
    const { openNodePathPairing } = await import('./NodePathController')
    openNodePathPairing()
    return
  }
  if (!registrationId) return
  const connection = NodeService.getInstance().connection(registrationId)
  if (action === 'reconnect') {
    await connection.connect()
    return
  }
  if (action === 'trust' && target) {
    if (!nodeAdvertisesMethod(connection.client, 'project.trust'))
      throw new Error(t('node.error.ownerOnly'))
    const project = await connection.client.getProject(target.projectId)
    if (project.trust === 'trusted') return
    if (
      !(await confirmDialog({
        title: t('node.trust.title'),
        message: t('node.trust.message', { path: project.root_path }),
        confirmText: t('node.trust.allow'),
      }))
    )
      return
    const { NodePathMutations } = await import('./NodePathMutations')
    await new NodePathMutations(connection.client).trust(target.projectId)
  }
}
