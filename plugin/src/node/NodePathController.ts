import { Menu, Notice, Platform } from 'obsidian'
import type { WorktreeEntry } from '@abele/node-protocol'
import { NodeSuggestModal } from '@/components/nodeWork/NodeSuggestModal'
import { confirmAction } from '@/modal/confirm'
import { changeProjectExternalBrowsing, externalBrowsingConfirm } from './repositorySettings'
import { GlobalStore } from '@/stores/GlobalStore'
import { NodeService } from './NodeService'
import { nodeProviders, providerAvailable, providerLabel } from './providers'
import { bindPathTarget } from './nodePathChat'
import { NodePathMutations } from './NodePathMutations'
import { pathPages } from './NodePathClientPort'
import { nodePathDialog, openNodeFolderPicker, openNodeWorktreeDialog } from './NodePathDialogs'
import { openNodePathTab } from './nodePathNavigation'
import {
  freezeNodePathContext,
  nodePathOwnerActions,
  type NodePathContext,
} from './NodePathOwnerActions'
import type { NodePathModel, PathTarget } from './NodePathModel'
import { showNodePairingDialog } from './NodePairingDialogHost'
import { h } from 'vue'

const app = () => GlobalStore.getInstance().app
export const nodePathAction = (run: () => Promise<unknown> | void): void => {
  void Promise.resolve()
    .then(run)
    .catch(
      (error: unknown) => new Notice(error instanceof Error ? error.message : 'Node action failed')
    )
}
const position = (event: MouseEvent) => ({ x: event.clientX, y: event.clientY })
export function showNodePathFileMenu(event: MouseEvent, raw: NodePathContext): void {
  event.preventDefault()
  const context = freezeNodePathContext(raw),
    menu = new Menu(),
    owner = nodePathOwnerActions()
  if (context.path) {
    menu.addItem((i) =>
      i
        .setTitle('Open')
        .setIcon('file-text')
        .onClick(() =>
          nodePathAction(() =>
            openNodePathTab(
              app().workspace,
              { kind: 'file', target: context.target, path: context.path! },
              Platform.isMobile
            )
          )
        )
    )
    menu.addItem((i) =>
      i
        .setTitle('Open in code editor')
        .setIcon('file-code')
        .setDisabled(context.revision?.kind === 'commit')
        .onClick(() =>
          nodePathAction(() =>
            openNodePathTab(
              app().workspace,
              { kind: 'editor', target: context.target, path: context.path! },
              Platform.isMobile
            )
          )
        )
    )
  }
  menu.addItem((i) =>
    i
      .setTitle('Ask here')
      .setIcon('message-square')
      .setDisabled(!owner)
      .onClick(() => nodePathAction(() => owner!.ask(context)))
  )
  menu.addItem((i) =>
    i
      .setTitle('Add to chat')
      .setIcon('messages-square')
      .setDisabled(!owner)
      .onClick(() => nodePathAction(() => owner!.add(context)))
  )
  menu.addItem((i) =>
    i
      .setTitle(context.path ? 'Copy path' : 'Copy commit')
      .setIcon('copy')
      .onClick(() =>
        nodePathAction(() => navigator.clipboard.writeText(context.path ?? context.commit ?? ''))
      )
  )
  menu.showAtPosition(position(event))
}
export function showNodePathRowMenu(model: NodePathModel, event: MouseEvent, id: string): void {
  const folder = model.folders.value.find((f) => f.id === id || f.copies.some((c) => c.id === id))
  if (!folder) return
  const target = { ...model.target(id === folder.id ? (folder.copies[0]?.id ?? id) : id) }
  const connection = NodeService.getInstance().connection(model.registrationId)
  const online = connection.state.value === 'connected',
    git = folder.git
  const menu = new Menu(),
    owner = nodePathOwnerActions()
  const add = (title: string, icon: string, enabled: boolean, run: () => Promise<unknown> | void) =>
    menu.addItem((i) =>
      i
        .setTitle(title)
        .setIcon(icon)
        .setDisabled(!enabled)
        .onClick(() => nodePathAction(run))
    )
  add('New chat', 'message-square-plus', online, () => newNodePathChat(model, target))
  add('History', 'history', git, () =>
    openNodePathTab(app().workspace, { kind: 'history', target }, Platform.isMobile)
  )
  add('Refresh folder', 'refresh-cw', online, () => model.reloadTarget(target))
  if (git) {
    add(
      'New worktree',
      'git-branch-plus',
      online && model.capabilities.value.includes('node_path_worktrees'),
      () => openNodeWorktreeDialog(model, connection, target)
    )
    add(
      'Attach a worktree',
      'link',
      online && model.capabilities.value.includes('node_path_v2'),
      async () => {
        const rows = await pathPages((cursor) =>
          connection.client.repository.worktrees({
            project_id: target.projectId,
            include_selection: true,
            cursor,
          })
        )
        new NodeSuggestModal(
          app(),
          rows
            .filter((w) => !w.listed && w.availability === 'available')
            .map((w) => ({
              id: w.worktree_id,
              title: w.branch?.replace(/^refs\/heads\//, '') ?? 'Detached',
              note: w.path_label,
              icon: 'git-branch',
              kind: 'Existing worktree',
            })),
          'Attach an existing worktree',
          (item) =>
            nodePathAction(async () => {
              const row = rows.find((entry) => entry.worktree_id === item.id)
              if (row) await attachNodePathWorktree(model, target, row)
            })
        ).open()
      }
    )
    // The project's other worktrees, Orca's among them, opened to read-only browsing or closed
    // again: the same switch as the repository tab's menu, here where the project is.
    for (const enabled of [true, false])
      add(
        enabled ? 'Allow external workspace browsing' : 'Stop browsing external workspaces',
        enabled ? 'folder-git-2' : 'folder-closed',
        online && !!owner,
        async () => {
          const changed = await changeProjectExternalBrowsing(
            connection.client,
            target.projectId,
            enabled,
            () => confirmAction(app(), externalBrowsingConfirm(enabled))
          )
          if (changed) await model.refresh()
        }
      )
    const row = folder.copies.find((c) => c.id === target.id)
    if (row?.kind !== 'project') {
      add(
        'Remove from the list',
        'unlink',
        online && model.capabilities.value.includes('node_path_v2'),
        async () => {
          await new NodePathMutations(connection.client).selection(
            target.projectId,
            target.id,
            false
          )
          await model.refresh()
          if (model.selected.value === target.id && folder.copies[0])
            await model.select(folder.copies[0].id)
        }
      )
      add(
        'Delete the worktree…',
        'trash',
        online && model.capabilities.value.includes('node_path_worktrees'),
        async () => {
          const rows = await pathPages((cursor) =>
            connection.client.repository.worktrees({
              project_id: target.projectId,
              include_selection: true,
              cursor,
            })
          )
          const selected = rows.find((w) => w.worktree_id === target.id)
          if (!selected || selected.kind === 'root')
            throw new Error('This worktree is no longer available for deletion.')
          if (
            !(await confirmAction(app(), {
              title: 'Delete worktree?',
              message: `Delete ${selected.path_label}? This removes the working copy, not its branch. Dirty, ignored and untracked files block deletion.`,
              confirmText: 'Delete worktree',
            }))
          )
            return
          const observation = await connection.client.repository.observe({ worktree_id: target.id })
          if (observation.revision.kind !== 'working')
            throw new Error('The node did not return a current observation.')
          if (selected.kind === 'managed' && selected.workspace_id) {
            const reservation = await new NodePathMutations(connection.client).removeManaged(
              selected.workspace_id
            )
            new Notice(`Deletion accepted; refresh to check job ${reservation.job_id}.`)
          } else
            await new NodePathMutations(connection.client).delete(
              target,
              selected,
              observation.revision.observation_id
            )
          await model.refresh()
        }
      )
    }
  } else
    add(
      'Make it a Git repository…',
      'folder-git-2',
      online && model.capabilities.value.includes('node_path_v2'),
      async () => {
        if (
          !(await confirmAction(app(), {
            title: 'Initialize Git repository?',
            message: `Initialize Git in ${folder.path}? No first commit is created.`,
            confirmText: 'Initialize Git',
          }))
        )
          return
        await new NodePathMutations(connection.client).init(folder.id, 'main')
        await model.refresh()
        const root = model.targets.value.find((t) => t.projectId === folder.id)
        if (root) await model.select(root.id)
      }
    )
  add('Give the Obsidian chat access', 'messages-square', !!owner, () =>
    owner!.grant(freezeNodePathContext({ target }))
  )
  add('Copy path', 'copy', true, () =>
    navigator.clipboard.writeText(
      folder.copies.find((c) => c.id === target.id)?.path ?? folder.path
    )
  )
  menu.showAtPosition(position(event))
}
export function showNodePathChatMenu(model: NodePathModel, event: MouseEvent, id: string): void {
  const session = model.sessions.value.find((s) => s.session.session_id === id)
  if (!session?.target) return
  const target = Object.freeze({ ...session.target })
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle('Open')
      .setIcon('message-square')
      .onClick(() =>
        nodePathAction(() =>
          openNodePathTab(
            app().workspace,
            {
              kind: 'chat',
              target,
              sessionId: id,
              title: session.session.title,
            },
            Platform.isMobile
          )
        )
      )
  )
  menu.showAtPosition(position(event))
}
export function showNodePathNodeMenu(model: NodePathModel, event: MouseEvent): void {
  const menu = new Menu(),
    service = NodeService.getInstance()
  menu.addItem((i) =>
    i.setTitle('Connect another node').setIcon('server').onClick(openNodePathPairing)
  )
  for (const node of service.nodes.value)
    menu.addItem((i) =>
      i
        .setTitle(node.label)
        .setIcon('server')
        .setChecked(node.id === model.registrationId)
        .onClick(() =>
          nodePathAction(async () => {
            const leaf = app().workspace.getLeavesOfType('abele-node-sidebar')[0]
            if (leaf)
              await leaf.setViewState({
                type: 'abele-node-sidebar',
                state: { registrationId: node.id },
                active: true,
              })
          })
        )
    )
  const node = service.nodes.value.find((n) => n.id === model.registrationId)
  if (node) {
    menu.addItem((i) =>
      i
        .setTitle('Node details')
        .setIcon('info')
        .onClick(() => {
          nodePathDialog('Node details', () =>
            h('div', [
              h('p', node.label),
              h('p', node.url),
              h('p', `Node ID: ${node.expectedNodeId}`),
            ])
          )
        })
    )
    menu.addItem((i) =>
      i
        .setTitle('Disconnect this device…')
        .setIcon('unplug')
        .onClick(() =>
          nodePathAction(async () => {
            if (
              await confirmAction(app(), {
                title: 'Disconnect node?',
                message:
                  'Remove this device’s saved connection. This does not delete folders, worktrees or node sessions.',
                confirmText: 'Disconnect',
              })
            )
              service.remove(model.registrationId)
          })
        )
    )
  }
  menu.showAtPosition(position(event))
}
export async function attachNodePathWorktree(
  model: NodePathModel,
  target: PathTarget,
  row: WorktreeEntry
): Promise<void> {
  if (row.project_id !== target.projectId)
    throw new Error('The selected worktree belongs to another project.')
  const connection = NodeService.getInstance().connection(model.registrationId)
  await new NodePathMutations(connection.client).selection(target.projectId, row.worktree_id, true)
  const selecting = model.selectTarget(
    { ...target, kind: 'worktree', id: row.worktree_id },
    {
      id: row.worktree_id,
      kind: row.kind === 'root' ? 'project' : row.detached ? 'detached' : 'worktree',
      branch: row.branch?.replace(/^refs\/heads\//, '') ?? 'Detached',
      path: row.path_label,
      changed: 0,
    }
  )
  void model.refresh().catch((error: unknown) => model.report(error))
  await selecting
}
export function openNodePathPairing(): void {
  showNodePairingDialog()
}
export async function newNodePathChat(
  model: NodePathModel,
  target = model.current.value,
  initialText?: string
): Promise<void> {
  if (!target) throw new Error('Choose a folder or worktree first.')
  if (!model.capabilities.value.includes('node_path_execution'))
    throw new Error(
      'Update this node to enable chats bound to root, plain and external folders. Existing managed sessions remain available.'
    )
  const bound = Object.freeze({ ...target }),
    connection = NodeService.getInstance().connection(model.registrationId)
  const providers = nodeProviders(await connection.client.describe()).filter(providerAvailable)
  new NodeSuggestModal(
    app(),
    providers.map((p) => ({
      id: p.provider,
      title: providerLabel(p.provider),
      note: p.diagnostic,
      icon: 'bot',
      kind: 'Agent provider',
    })),
    'Choose the node agent',
    (item) =>
      nodePathAction(async () => {
        if (!(await approveNodePathExecution(model, bound))) return
        const provider = providers.find((p) => p.provider === item.id)
        if (!provider) throw new Error('The selected provider is no longer available.')
        const session = await new NodePathMutations(connection.client).session(
          bound,
          'New chat',
          provider.provider
        )
        // The returned session already carries this exact target. Refresh drawer metadata
        // in the background; recursively listing its files is not part of opening a chat.
        void model.refresh().catch((error: unknown) => model.report(error))
        model.selectedChat.value = session.session_id
        await openNodePathTab(
          app().workspace,
          { kind: 'chat', target: bound, sessionId: session.session_id, title: session.title },
          Platform.isMobile
        )
        if (initialText) {
          const leaf = app()
            .workspace.getLeavesOfType('abele-node-chat')
            .find(
              (leaf) =>
                (leaf.getViewState().state as { sessionId?: string } | undefined)?.sessionId ===
                session.session_id
            )
          ;(leaf?.view as unknown as { appendChatText?: (text: string) => void })?.appendChatText?.(
            initialText
          )
        }
      })
  ).open()
}
export async function chooseSessionWorktree(
  model: NodePathModel,
  sessionId: string
): Promise<void> {
  if (!model.capabilities.value.includes('node_path_execution'))
    throw new Error('Update this node to enable session worktree switching.')
  const connection = NodeService.getInstance().connection(model.registrationId)
  const session = await connection.client.getSession(sessionId)
  if (session.native_session_id && !model.capabilities.value.includes('node_path_native_switching'))
    throw new Error(
      'This node cannot safely continue a provider-bound conversation in another worktree yet. Keep this chat in its current target.'
    )
  const binding = await connection.client.nodePath.sessionWorktreeGet({ session_id: sessionId })
  const from = bindPathTarget(
    { nodeId: model.nodeId, registrationId: model.registrationId },
    binding.project_id,
    binding.target
  )
  const targets = model.targets.value.filter(
    (t) =>
      t.projectId === from.projectId &&
      (t.id !== from.id || t.kind !== from.kind) &&
      !model.copy(t)?.missing
  )
  new NodeSuggestModal(
    app(),
    targets.map((t) => ({
      id: t.id,
      title:
        model.copy(t)?.branch ??
        model.folders.value.find((f) => f.id === t.projectId)?.name ??
        'Folder',
      note: model.copy(t)?.path,
      icon: 'git-branch',
      kind: 'Worktree',
    })),
    'Move this idle chat to a worktree',
    (item) =>
      nodePathAction(async () => {
        const to = targets.find((t) => t.id === item.id)
        if (!to || !(await approveNodePathExecution(model, to))) return
        await new NodePathMutations(connection.client).switch(sessionId, from, to)
        await model.refresh()
      }),
    'No other available worktree in this folder'
  ).open()
}
async function approveNodePathExecution(
  model: NodePathModel,
  target: PathTarget
): Promise<boolean> {
  const connection = NodeService.getInstance().connection(model.registrationId)
  if (connection.state.value !== 'connected')
    throw new Error('Reconnect before approving agent execution.')
  const folder = model.folders.value.find((f) => f.id === target.projectId),
    copy = model.copy(target)
  if (
    !(await confirmAction(app(), {
      title: 'Allow agent execution in this target?',
      message: `Allow the node agent to execute in ${copy?.path ?? folder?.path ?? 'this target'}? This trusts its registered project and enables execution for this exact folder or worktree identity. Reading, listing or attaching alone never enables execution.`,
      confirmText: 'Allow execution',
    }))
  )
    return false
  const mutations = new NodePathMutations(connection.client)
  await mutations.trust(target.projectId)
  await mutations.execution(target)
  return true
}
export const openFolderForNode = (model: NodePathModel) =>
  openNodeFolderPicker(model, NodeService.getInstance().connection(model.registrationId))
