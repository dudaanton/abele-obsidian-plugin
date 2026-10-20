import { t } from '@/i18n'
import { ChannelError } from '@abele/channel-protocol'
import { confirmDialog, promptDialog } from '@/components/obsidian/dialogs'
import { NodeService } from './NodeService'
import { NodePathService } from './NodePathService'
import { NodePathMutations } from './NodePathMutations'
import { openNodePathTab } from './nodePathNavigation'
import { GlobalStore } from '@/stores/GlobalStore'
import { Platform } from 'obsidian'
import type { NodePathContext } from './NodePathOwnerActions'

export type TreeAction = 'newFile' | 'newFolder' | 'rename' | 'move' | 'delete'
export async function nodeTreeAction(action: TreeAction, context: NodePathContext): Promise<void> {
  const target = context.target
  const connection = NodeService.getInstance().connection(target.registrationId)
  if (connection.state.value !== 'connected') throw new ChannelError('disconnected')
  if (target.kind === 'worktree') {
    const access = await connection.client.repository.editingStatus({ worktree_id: target.id })
    if (!access.enabled) {
      if (
        !(await confirmDialog({
          title: t('streamB.allowEditingInThisWorktree.0b5778'),
          message: t('node.files.allowEditing'),
          confirmText: t('streamB.allowEditing.8195ed'),
        }))
      )
        return
      await connection.client.repository.editing({ worktree_id: target.id, enabled: true })
    }
  }
  const model = NodePathService.getInstance().model(target.registrationId)
  const mutations = new NodePathMutations(connection.client)
  const path = context.path ?? ''
  const parent = context.directory ? path : path.slice(0, Math.max(0, path.lastIndexOf('/')))
  if (action === 'newFile' || action === 'newFolder') {
    const destination = await promptDialog({
      title: t(action === 'newFile' ? 'node.files.newFile' : 'node.files.newFolder'),
      value: parent ? `${parent}/` : '',
      submitText: t('streamB.create.475949'),
    })
    if (!destination) return
    if (action === 'newFolder') await mutations.fileMkdir(target, destination)
    else await mutations.createFile(target, destination)
    await model.reloadTarget(target)
    if (action === 'newFile')
      await openNodePathTab(
        GlobalStore.getInstance().app.workspace,
        { kind: 'file', target, path: destination, edit: true },
        Platform.isMobile
      )
    return
  }
  const file = context.contentId
    ? context
    : await model.port.file(target, path, undefined, context.revision)
  if (!file.contentId) throw new ChannelError('unsupported_method')
  if (action === 'delete') {
    if (
      !(await confirmDialog({
        title: t('node.files.delete'),
        message: t('node.files.deleteConfirm', { path }),
        confirmText: t('node.files.delete'),
      }))
    )
      return
    await mutations.fileRemove(target, path, file.contentId)
  } else {
    const renaming = action === 'rename'
    const value = await promptDialog({
      title: t(renaming ? 'node.files.rename' : 'node.files.move'),
      value: renaming ? path.split('/').pop() : path,
      submitText: t(renaming ? 'node.files.rename' : 'node.files.move'),
      validate: renaming
        ? (name) =>
            /[\\/]/.test(name) || ['.', '..'].includes(name) ? t('node.files.nameOnly') : ''
        : undefined,
    })
    if (!value) return
    const destination = renaming && parent ? `${parent}/${value}` : value
    if (destination === path) return
    await mutations.fileMove(target, path, destination, file.contentId)
  }
  await model.reloadTarget(target)
}
