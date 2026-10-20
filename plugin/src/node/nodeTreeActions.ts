import { t } from '@/i18n'
import { UiError, uiMessage } from '@/i18n/streamBErrors'
import { ChannelError } from '@abele/channel-protocol'
import { confirmDialog, promptDialog } from '@/components/obsidian/dialogs'
import { NodeService } from './NodeService'
import { NodePathService } from './NodePathService'
import { NodePathMutations } from './NodePathMutations'
import { openNodePathTab, updateNodeFileTabs } from './nodePathNavigation'
import { GlobalStore } from '@/stores/GlobalStore'
import { Platform } from 'obsidian'
import type { NodePathContext } from './NodePathOwnerActions'
import { nodeAdvertisesMethod } from './advertisedMethods'
import { directoryPreview } from './nodeDirectoryPreview'

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
  const parent = path.slice(0, Math.max(0, path.lastIndexOf('/')))
  if (action === 'newFile' || action === 'newFolder') {
    const destination = await promptDialog({
      title: t(action === 'newFile' ? 'node.files.newFile' : 'node.files.newFolder'),
      value: (context.directory ? path : parent) ? `${context.directory ? path : parent}/` : '',
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
  const directory = context.directory === true
  if (
    directory &&
    !nodeAdvertisesMethod(
      connection.client,
      `${target.kind === 'worktree' ? 'repository.v1' : 'workspace'}.file.directory`
    )
  )
    throw new ChannelError('unsupported_method')
  const manifest = directory
    ? await connection.client.nodePath.fileDirectory({
        ...(target.kind === 'worktree' ? { worktree_id: target.id } : { workspace_id: target.id }),
        path,
      })
    : undefined
  const file = manifest
    ? { contentId: manifest.content_id }
    : context.contentId
      ? context
      : await model.port.file(target, path, undefined, context.revision)
  if (!file.contentId) throw new ChannelError('unsupported_method')
  const preview = manifest
    ? await directoryPreview(connection.client, target, path, manifest.entries)
    : undefined
  const counts = preview
    ? {
        path,
        files: t('node.files.fileCount', { count: preview.files }),
        folders: t('node.files.folderCount', { count: preview.folders }),
      }
    : undefined
  if (action === 'delete') {
    if (
      !(await confirmDialog({
        title: t('node.files.delete'),
        message: t('node.files.deleteConfirm', { path }),
        confirmText: t('kit.delete'),
        ...(preview && counts
          ? {
              message: t('node.files.directoryDeleteSummary', counts),
              details: preview.details,
            }
          : {}),
      }))
    )
      return
    if (directory) await mutations.fileRemove(target, path, file.contentId, true)
    else await mutations.fileRemove(target, path, file.contentId)
    await updateNodeFileTabs(GlobalStore.getInstance().app.workspace, target, path)
  } else {
    const renaming = action === 'rename'
    const value = await promptDialog({
      title: t(renaming ? 'node.files.rename' : 'node.files.move'),
      value: renaming ? path.split('/').pop() : path,
      submitText: t(renaming ? 'node.files.renameAction' : 'node.files.moveAction'),
      validate: renaming
        ? (name) => {
            if (!name || /[\\/]/.test(name) || ['.', '..'].includes(name))
              throw new UiError(uiMessage('node.files.nameOnly'))
            return name
          }
        : undefined,
    })
    if (!value) return
    const destination = renaming && parent ? `${parent}/${value}` : value
    if (destination === path) return
    if (manifest && preview && counts) {
      if (
        !(await confirmDialog({
          title: t(renaming ? 'node.files.rename' : 'node.files.move'),
          message: t('node.files.directoryMoveSummary', { ...counts, destination }),
          details: preview.details,
          confirmText: t(renaming ? 'node.files.renameAction' : 'node.files.moveAction'),
        }))
      )
        return
      await mutations.fileMove(target, path, destination, file.contentId, true)
    } else await mutations.fileMove(target, path, destination, file.contentId)
    await updateNodeFileTabs(GlobalStore.getInstance().app.workspace, target, path, destination)
  }
  await model.reloadTarget(target)
}
