import { nodeErrorNotice } from './errorNotice'
import { UiError, uiMessage } from '@/i18n/streamBErrors'
import { addFolderDebugMenu } from '@/debugger/folderActions'
import { t } from '@/i18n'
import { Menu, Notice, Platform } from 'obsidian'
import type { WorktreeEntry } from '@abele/node-protocol'
import { NodeSuggestModal } from '@/components/nodeWork/NodeSuggestModal'
import { confirmDialog } from '@/components/obsidian/dialogs'
import {
  changeProjectExternalBrowsing,
  externalBrowsingConfirm,
  projectExternalBrowsing,
} from './repositorySettings'
import { GlobalStore } from '@/stores/GlobalStore'
import { NodeService } from './NodeService'
import { agentChoices, nodeProviders, type AgentChoice } from './providers'
import { preferredAgentChoices, lastNodeAgent, rememberNodeAgent } from './agentPreference'
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
import { shortRef } from './presentation'
import { worktreeDisplayPath } from './worktreePresentation'
import { copyIcon, copyKind } from '@/components/nodeWork/codes'
import type { FolderSummary } from '@/components/nodeWork/types'
import { nodePathMenuPosition as position } from './nodePathMenuPosition'
import { nodeTreeAction, type TreeAction } from './nodeTreeActions'
import { nodeAdvertisesMethod } from './advertisedMethods'
import { worktreeBusy } from './worktreeBusy'

const app = () => GlobalStore.getInstance().app
export const nodePathAction = (run: () => Promise<unknown> | void): void => {
  void Promise.resolve()
    .then(run)
    .catch((error: unknown) => nodeErrorNotice(error, t('streamB.nodeActionFailed.35c41e')))
}
export function showNodePathFileMenu(event: MouseEvent, raw: NodePathContext): void {
  event.preventDefault()
  const context = freezeNodePathContext(raw),
    menu = new Menu(),
    owner = nodePathOwnerActions()
  if (context.path && !context.directory) {
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.open.ed077f'))
        .setIcon('file-text')
        .onClick(() =>
          nodePathAction(() =>
            openNodePathTab(
              app().workspace,
              { kind: 'file', target: context.target, path: context.path },
              Platform.isMobile
            )
          )
        )
    )
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.edit.464c4f'))
        .setIcon('pencil')
        .setDisabled(context.revision?.kind === 'commit')
        .onClick(() =>
          nodePathAction(() =>
            openNodePathTab(
              app().workspace,
              { kind: 'file', target: context.target, path: context.path!, edit: true },
              Platform.isMobile
            )
          )
        )
    )
  }
  addNodeTreeActions(menu, context)
  menu.addItem((i) =>
    i
      .setTitle(t('streamB.askHere.7b4ec4'))
      .setIcon('message-square')
      .setDisabled(!owner)
      .onClick(() => nodePathAction(() => owner!.ask(context)))
  )
  menu.addItem((i) =>
    i
      .setTitle(t('streamB.addToChat.b33b61'))
      .setIcon('messages-square')
      .setDisabled(!owner)
      .onClick(() => nodePathAction(() => owner!.add(context)))
  )
  menu.addItem((i) =>
    i
      .setTitle(context.path ? t('streamB.copyPath.720ff4') : t('streamB.copyCommit.ecaa70'))
      .setIcon('copy')
      .onClick(() =>
        nodePathAction(() => navigator.clipboard.writeText(context.path ?? context.commit ?? ''))
      )
  )
  const at = position(event)
  nodePathAction(async () => {
    await addFolderDebugMenu(menu, context.target, context.path)
    menu.showAtPosition(at)
  })
}
function addNodeTreeActions(menu: Menu, context: NodePathContext): void {
  if (context.revision?.kind === 'commit') return
  const client = NodeService.getInstance().connection(context.target.registrationId).client
  const prefix = context.target.kind === 'worktree' ? 'repository.v1' : 'workspace'
  const actions: [TreeAction, string, string][] = [
    ['newFile', 'file-plus', `${prefix}.write`],
    ['newFolder', 'folder-plus', `${prefix}.file.mkdir`],
    ...(context.path &&
    (!context.directory || nodeAdvertisesMethod(client, `${prefix}.file.directory`))
      ? ([
          ['rename', 'pencil', `${prefix}.file.move`],
          ['move', 'folder-input', `${prefix}.file.move`],
          ['delete', 'trash', `${prefix}.file.remove`],
        ] as [TreeAction, string, string][])
      : []),
  ]
  for (const [action, icon, method] of actions) {
    if (!nodeAdvertisesMethod(client, method)) continue
    menu.addItem((item) => {
      item
        .setTitle(t(`node.files.${action}`))
        .setIcon(icon)
        .onClick(() => nodePathAction(() => nodeTreeAction(action, context)))
      if (action === 'delete') item.setWarning(true)
    })
  }
}
/** The folder's or worktree's menu, built once the node said whether outside worktrees are open. */
function withRowMenu(
  model: NodePathModel,
  id: string,
  show: (menu: Menu) => void,
  into?: Menu,
  panel = false
): void {
  const folder = model.folders.value.find((f) => f.id === id || f.copies.some((c) => c.id === id))
  if (!folder) return
  const target = { ...model.target(id === folder.id ? (folder.copies[0]?.id ?? id) : id) }
  const connection = NodeService.getInstance().connection(model.registrationId)
  const menu = into ?? new Menu()
  // A repository's menu shows whether its other worktrees are open, and a folder's whether it
  // takes the repository's Claude permissions, so it asks the node first.
  nodePathAction(async () => {
    const [external, project] =
      connection.state.value === 'connected'
        ? await Promise.all([
            folder.git ? projectExternalBrowsing(connection.client, target.projectId) : undefined,
            connection.client.getProject(folder.id).catch((): undefined => undefined),
          ])
        : [undefined, undefined]
    await addFolderDebugMenu(menu, target)
    menu.addSeparator()
    show(rowMenu(model, folder, target, external, menu, panel, project))
  })
}
function rowMenu(
  model: NodePathModel,
  folder: NodePathModel['folders']['value'][number],
  target: PathTarget,
  external?: boolean,
  into?: Menu,
  /** In the panel's place menu: new chat, history and refresh are already there. */
  panel = false,
  /** What the node says of the folder's settings, where it could be asked. */
  project?: { use_repository_claude_permissions: boolean }
): Menu {
  const connection = NodeService.getInstance().connection(model.registrationId)
  const online = connection.state.value === 'connected',
    git = folder.git
  const menu = into ?? new Menu(),
    owner = nodePathOwnerActions()
  addNodeTreeActions(menu, { target, directory: true })
  const add = (
    title: string,
    icon: string,
    enabled: boolean,
    run: () => Promise<unknown> | void,
    checked?: boolean
  ) =>
    menu.addItem((i) => {
      i.setTitle(title)
        .setIcon(icon)
        .setDisabled(!enabled)
        .onClick(() => nodePathAction(run))
      if (checked) i.setChecked(true)
    })
  // What cannot be undone comes last, apart, in the warning colour.
  const danger: [string, string, boolean, () => Promise<unknown> | void][] = []
  const addDanger = (
    title: string,
    icon: string,
    enabled: boolean,
    run: () => Promise<unknown> | void
  ) => danger.push([title, icon, enabled, run])
  if (!panel) {
    add(t('streamB.newChat.db1838'), 'message-square-plus', online, () =>
      newNodePathChat(model, target)
    )
    add(t('streamB.history.0e7696'), 'history', git, () =>
      openNodePathTab(app().workspace, { kind: 'history', target }, Platform.isMobile)
    )
    add(t('streamB.refreshFolder.f962de'), 'refresh-cw', online, () => model.reloadTarget(target))
  }
  if (git) {
    add(
      t('streamB.newWorktree.4f210a'),
      'git-branch-plus',
      online && model.capabilities.value.includes('node_path_worktrees'),
      () => openNodeWorktreeDialog(model, connection, target)
    )
    add(
      t('streamB.attachAWorktree.e28b2d'),
      'link',
      online && model.capabilities.value.includes('node_path_v2'),
      async () => {
        if (
          !(await confirmDialog({
            title: t('streamB.attachAnExistingWorktree.52c0f9'),
            message: t('node.files.attachMessage'),
            confirmText: t('streamB.allowEditing.8195ed'),
          }))
        )
          return
        if (external !== true) {
          const allowed = await changeProjectExternalBrowsing(
            connection.client,
            target.projectId,
            true,
            async () => true
          )
          if (!allowed) return
        }
        const rows = await pathPages((cursor) =>
          connection.client.repository.worktrees({
            project_id: target.projectId,
            include_selection: true,
            ...(nodeAdvertisesMethod(connection.client, 'repository.v1.file.directory')
              ? { include_identity: true }
              : {}),
            cursor,
          })
        )
        new NodeSuggestModal(
          app(),
          rows
            .filter((w) => !w.listed && w.availability === 'available')
            .map((w) => ({
              id: w.worktree_id,
              title: w.branch?.replace(/^refs\/heads\//, '') ?? t('streamB.detached.134385'),
              note: worktreeDisplayPath(w.path_label, w.branch),
              icon: 'git-branch',
              kind: t('streamB.pickerExistingWorktree'),
            })),
          t('streamB.attachAnExistingWorktree.52c0f9'),
          (item) =>
            nodePathAction(async () => {
              const row = rows.find((entry) => entry.worktree_id === item.id)
              if (row) await attachNodePathWorktree(model, target, row)
            })
        ).open()
      }
    )
    // The project's other worktrees, Orca's among them, opened to read-only browsing or closed
    // again. A node that says whether browsing is on gets one switch with its check; one that
    // cannot say gets both ways, as the repository tab's menu has them.
    const browsing = (enabled: boolean, title: string, checked = false) =>
      add(
        title,
        enabled ? 'folder-git-2' : 'folder-closed',
        online && !!owner,
        async () => {
          const changed = await changeProjectExternalBrowsing(
            connection.client,
            target.projectId,
            enabled,
            () => confirmDialog(externalBrowsingConfirm(enabled))
          )
          if (changed) await model.refresh()
        },
        checked
      )
    if (external === undefined) {
      browsing(true, t('streamB.allowExternalWorkspaceBrowsing.565667'))
      browsing(false, t('streamB.stopBrowsingExternalWorkspaces.03d51a'))
    } else browsing(!external, t('streamB.browseExternalWorkspaces.7e9d46'), external)
    const row = folder.copies.find((c) => c.id === target.id)
    if (row?.kind !== 'project') {
      addDanger(
        t('streamB.removeFromTheList.f532c3'),
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
      addDanger(
        t('streamB.deleteTheWorktree.ca8a5f'),
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
            throw new UiError(uiMessage('streamB.thisWorktreeIsNoLongerAvailableFor.44dd46'))
          if (
            !(await confirmDialog({
              title: t('streamB.deleteWorktree.89ba18'),
              message: t('streamB.deleteThisRemovesTheWorkingCopyNot.d7af59', {
                v0: worktreeDisplayPath(selected.path_label, selected.branch),
              }),
              confirmText: t('streamB.deleteWorktree.348a63'),
            }))
          )
            return
          const observation = await connection.client.repository.observe({ worktree_id: target.id })
          if (observation.revision.kind !== 'working')
            throw new UiError(uiMessage('streamB.theNodeDidNotReturnACurrent.beb9d0'))
          try {
            if (selected.kind === 'managed' && selected.workspace_id) {
              const reservation = await new NodePathMutations(connection.client).removeManaged(
                selected.workspace_id
              )
              new Notice(
                t('streamB.deletionAcceptedRefreshToCheckJob.de2efa', {
                  v0: String(reservation.job_id),
                })
              )
            } else
              await new NodePathMutations(connection.client).delete(
                target,
                selected,
                observation.revision.observation_id
              )
          } catch (error) {
            const busy = worktreeBusy(error, model, target)
            if (!busy) throw error
            const holders = busy.labels.join(', ') || t('node.files.unknownHolder')
            if (!busy.sessions.length) {
              new Notice(t('node.files.worktreeBusy', { holders }))
              return
            }
            if (
              await confirmDialog({
                title: t('node.files.worktreeBusyTitle'),
                message: t('node.files.worktreeBusy', { holders }),
                confirmText: t('node.files.stopSessions'),
              })
            ) {
              for (const session of busy.sessions) await connection.client.stopSession(session.id)
              new Notice(t('node.files.sessionsStopped'))
            }
            return
          }
          await model.refresh()
        }
      )
    }
  } else
    add(
      t('streamB.makeItAGitRepository.d23582'),
      'folder-git-2',
      online && model.capabilities.value.includes('node_path_v2'),
      async () => {
        if (
          !(await confirmDialog({
            title: t('streamB.initializeGitRepository.9ce562'),
            message: t('streamB.initializeGitInNoFirstCommitIs.2c7d56', {
              v0: String(folder.path),
            }),
            confirmText: t('streamB.initializeGit.4ee149'),
          }))
        )
          return
        await new NodePathMutations(connection.client).init(folder.id, 'main')
        await model.refresh()
        const root = model.targets.value.find(
          (translationItem) => translationItem.projectId === folder.id
        )
        if (root) await model.select(root.id)
      }
    )
  add(t('streamB.giveAChatAccess.8fcd7f'), 'folder-key', !!owner, () =>
    owner!.grant(freezeNodePathContext({ target }))
  )
  add(t('streamB.copyPath.720ff4'), 'copy', true, () =>
    navigator.clipboard.writeText(
      target.location?.path ?? folder.copies.find((c) => c.id === target.id)?.path ?? folder.path
    )
  )
  const root =
    folder.missing || !git || folder.copies.find((c) => c.id === target.id)?.kind === 'project'
  if (project && root)
    add(
      t('streamB.useTheRepositorySClaudePermissions.fe13bf'),
      'shield-check',
      online,
      async () => {
        await connection.client.setProjectClaudePermissions(
          folder.id,
          !project.use_repository_claude_permissions
        )
        await model.refresh()
      },
      project.use_repository_claude_permissions
    )
  if (root)
    addDanger(t('streamB.removeTheFolderFromTheNode.9e68fe'), 'list-x', online, () =>
      removeNodePathFolder(model, folder)
    )
  if (danger.length) menu.addSeparator()
  for (const [title, icon, enabled, run] of danger)
    menu.addItem((i) =>
      i
        .setTitle(title)
        .setIcon(icon)
        .setWarning(true)
        .setDisabled(!enabled)
        .onClick(() => nodePathAction(run))
    )
  return menu
}
/** Unregisters only the confirmed project. It never removes filesystem contents. */
export async function removeNodePathFolder(
  model: NodePathModel,
  folder: FolderSummary
): Promise<void> {
  const projectId = folder.id
  if (
    !(await confirmDialog({
      title: t('streamB.removeTheFolderFromTheNode.8ba1a8'),
      message: t('streamB.staysOnDiskWithItsFilesAnd.a19f63', { v0: String(folder.path) }),
      confirmText: t('streamB.removeFolder.f2a987'),
    }))
  )
    return
  const connection = NodeService.getInstance().connection(model.registrationId)
  await connection.client.removeProject(projectId)
  const wasSelected = model.current.value?.projectId === projectId
  if (wasSelected) model.selected.value = ''
  await model.refresh()
  const next = model.targets.value[0]
  if (wasSelected && next) await model.select(next.id)
}
export function showNodePathNodeMenu(model: NodePathModel, event: MouseEvent): void {
  const at = position(event)
  const target = model.current.value && { ...model.current.value }
  nodePathAction(async () => {
    const menu = await nodeItems(model, new Menu(), target ?? undefined)
    menu.showAtPosition(at)
  })
}
async function nodeItems(
  model: NodePathModel,
  menu: Menu,
  target?: PathTarget,
  debug = true
): Promise<Menu> {
  if (debug) await addFolderDebugMenu(menu, target)
  const service = NodeService.getInstance()
  menu.addItem((i) =>
    i
      .setTitle(t('streamB.connectAnotherNode.3738cb'))
      .setIcon('server')
      .onClick(openNodePathPairing)
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
        .setTitle(t('streamB.nodeDetails.835881'))
        .setIcon('info')
        .onClick(() => {
          nodePathDialog(t('streamB.nodeDetails.835881'), () =>
            h('div', [
              h('p', node.label),
              h('p', node.url),
              h('p', t('streamB.nodeId.780a6d', { v0: String(node.expectedNodeId) })),
            ])
          )
        })
    )
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.disconnectThisDevice.e1a820'))
        .setIcon('unplug')
        .onClick(() =>
          nodePathAction(async () => {
            if (
              await confirmDialog({
                title: t('streamB.disconnectNode.c336da'),
                message: t('streamB.removeThisDeviceSSavedConnectionThis.40e1d5'),
                confirmText: t('streamB.disconnect.acfc5b'),
              })
            )
              service.remove(model.registrationId)
          })
        )
    )
  }
  return menu
}
export async function attachNodePathWorktree(
  model: NodePathModel,
  target: PathTarget,
  row: WorktreeEntry
): Promise<void> {
  if (row.project_id !== target.projectId)
    throw new UiError(uiMessage('streamB.theSelectedWorktreeBelongsToAnotherProject.09bd1b'))
  const connection = NodeService.getInstance().connection(model.registrationId)
  if (row.kind === 'external')
    await connection.client.repository.editing({ worktree_id: row.worktree_id, enabled: true })
  await new NodePathMutations(connection.client).selection(target.projectId, row.worktree_id, true)
  const root =
    target.location?.root ??
    model.folders?.value.find((folder) => folder.id === target.projectId)?.path
  const path = row.identity?.canonical_path ?? row.path_label
  const copyLocation = root && path.startsWith('/') ? { root, path, kind: row.kind } : undefined
  const selecting = model.selectTarget(
    {
      nodeId: target.nodeId,
      registrationId: target.registrationId,
      projectId: target.projectId,
      kind: 'worktree',
      id: row.worktree_id,
      ...(copyLocation ? { location: copyLocation } : {}),
    },
    {
      id: row.worktree_id,
      kind: row.kind === 'root' ? 'project' : row.detached ? 'detached' : 'worktree',
      branch: row.branch?.replace(/^refs\/heads\//, '') ?? t('streamB.detached.134385'),
      path: worktreeDisplayPath(row.path_label, row.branch),
      changed: 0,
    }
  )
  void model.refresh().catch((error: unknown) => model.report(error))
  await selecting
}
export function openNodePathPairing(): void {
  showNodePairingDialog()
}
/** The glyph of an agent in the chooser: the node's own agents and ACP ones apart. */
const agentIcon = (provider: string): string =>
  provider === 'acp' ? 'plug' : provider === 'fake' ? 'flask-conical' : 'bot'

/** The agents' rows in the chooser, as the new-chat list and a test fixture show them. */
export function agentSuggestions(choices: AgentChoice[]) {
  return choices.map((c) => ({
    id: agentChoiceId(c),
    title: c.label,
    ...(c.unavailable ? { note: c.unavailable, disabled: c.unavailable } : {}),
    icon: agentIcon(c.provider),
    kind: c.agent ? t('streamB.pickerAcpAgent') : t('streamB.agent.11b39c'),
  }))
}
export const agentChoiceId = (c: AgentChoice): string =>
  c.agent ? `${c.provider}:${c.agent}` : c.provider

export async function newNodePathChat(
  model: NodePathModel,
  target = model.current.value,
  initialText?: string
): Promise<void> {
  if (!target) throw new UiError(uiMessage('streamB.chooseAFolderOrWorktreeFirst.007e1a'))
  if (!model.capabilities.value.includes('node_path_execution'))
    throw new UiError(uiMessage('streamB.updateThisNodeToEnableChatsBound.ad6e82'))
  const bound = Object.freeze({ ...target }),
    connection = NodeService.getInstance().connection(model.registrationId)
  const providers = nodeProviders(await connection.client.describe())
  const recent = [...(model.sessions?.value ?? [])].sort((a, b) =>
    b.session.created_at.localeCompare(a.session.created_at)
  )[0]?.session
  const choices = preferredAgentChoices(
    agentChoices(providers),
    providers,
    lastNodeAgent(model.nodeId, app()) ??
      (recent?.agent ? `${recent.provider}:${recent.agent}` : recent?.provider)
  )
  new NodeSuggestModal(
    app(),
    agentSuggestions(choices),
    t('streamB.chooseTheAgent.8f3bf5'),
    (item) => {
      const choice = choices.find((c) => agentChoiceId(c) === item.id && !c.unavailable)
      startNodePathChat(model, bound, choice, initialText)
    }
  ).open()
}

/**
 * A new chat with this agent at this place on the node, opened in the sidebar beside the other
 * chats; `initialText` goes into its draft, never sent.
 */
export function startNodePathChat(
  model: NodePathModel,
  target: PathTarget,
  choice: AgentChoice | undefined,
  initialText?: string
): void {
  const bound = Object.freeze({ ...target }),
    connection = NodeService.getInstance().connection(model.registrationId)
  nodePathAction(async () => {
    if (!(await approveNodePathExecution(model, bound))) return
    if (!choice) throw new UiError(uiMessage('streamB.theSelectedAgentIsNoLongerAvailable.b7a53d'))
    const session = await new NodePathMutations(connection.client).session(
      bound,
      t('streamB.newChat.db1838'),
      choice.provider,
      ...(choice.agent ? [choice.agent] : [])
    )
    rememberNodeAgent(model.nodeId, choice, app())
    // The returned session already carries this exact target. Refresh drawer metadata
    // in the background; recursively listing its files is not part of opening a chat.
    void model.refresh().catch((error: unknown) => model.report(error))
    model.selectedChat.value = session.session_id
    await openNodePathTab(
      app().workspace,
      { kind: 'chat', target: bound, sessionId: session.session_id, title: session.title },
      Platform.isMobile,
      ...(initialText ? [initialText] : [])
    )
  })
}
export async function chooseSessionWorktree(
  model: NodePathModel,
  sessionId: string
): Promise<void> {
  if (!model.capabilities.value.includes('node_path_execution'))
    throw new UiError(uiMessage('streamB.updateThisNodeToEnableSessionWorktree.31708c'))
  const connection = NodeService.getInstance().connection(model.registrationId)
  const session = await connection.client.getSession(sessionId)
  if (session.native_session_id && !model.capabilities.value.includes('node_path_native_switching'))
    throw new UiError(uiMessage('streamB.thisNodeCannotSafelyContinueAProvider.9a5301'))
  const binding = await connection.client.nodePath.sessionWorktreeGet({ session_id: sessionId })
  const from = bindPathTarget(
    { nodeId: model.nodeId, registrationId: model.registrationId },
    binding.project_id,
    binding.target
  )
  const targets = model.targets.value.filter(
    (translationItem) =>
      translationItem.projectId === from.projectId &&
      (translationItem.id !== from.id || translationItem.kind !== from.kind) &&
      !model.copy(translationItem)?.missing
  )
  new NodeSuggestModal(
    app(),
    targets.map((translationItem) => ({
      id: translationItem.id,
      title:
        model.copy(translationItem)?.branch ??
        model.folders.value.find((f) => f.id === translationItem.projectId)?.name ??
        t('streamB.folder.74ccd4'),
      note: model.copy(translationItem)?.path,
      icon: 'git-branch',
      kind: t('streamB.worktree.c893ba'),
    })),
    t('streamB.moveThisIdleChatToAWorktree.cfe156'),
    (item) =>
      nodePathAction(async () => {
        const to = targets.find((translationItem) => translationItem.id === item.id)
        if (!to || !(await approveNodePathExecution(model, to))) return
        await new NodePathMutations(connection.client).switch(sessionId, from, to)
        await model.refresh()
      }),
    t('streamB.noOtherAvailableWorktreeInThisFolder.024797')
  ).open()
}
export async function approveNodePathExecution(
  model: NodePathModel,
  target: PathTarget,
  purpose: 'agent' | 'debugger' = 'agent'
): Promise<boolean> {
  const connection = NodeService.getInstance().connection(model.registrationId)
  if (connection.state.value !== 'connected')
    throw new UiError(uiMessage('streamB.reconnectBeforeApprovingAgentExecution.f803e9'))
  const folder = model.folders.value.find((f) => f.id === target.projectId),
    copy = model.copy(target)
  const project = await connection.client.getProject(target.projectId)
  if (
    project.trust !== 'trusted' &&
    !(await confirmDialog({
      title: purpose === 'debugger' ? t('debug.executionTitle') : t('node.trust.title'),
      message: t(purpose === 'debugger' ? 'debug.executionMessage' : 'node.trust.message', {
        path: copy?.path ?? folder?.path ?? project.root_path,
      }),
      confirmText: t('node.trust.allow'),
    }))
  )
    return false
  const mutations = new NodePathMutations(connection.client)
  if (project.trust !== 'trusted') await mutations.trust(target.projectId)
  await mutations.execution(target)
  return true
}
export const openFolderForNode = (model: NodePathModel) =>
  openNodeFolderPicker(model, NodeService.getInstance().connection(model.registrationId))
/**
 * The panel's place search: every folder on the node, each worktree of a repository with its
 * changed files, and under each the node agent's chats that work there. Choosing a place shows
 * it in the panel; choosing a chat opens it.
 */
export function pickNodePathPlace(model: NodePathModel, openChat: (id: string) => void): void {
  const node = NodeService.getInstance().nodes.value.find((n) => n.id === model.registrationId)
  const chats = (list: NodePathModel['folders']['value'][number]['chats'], where: string) =>
    (list ?? []).map((chat) => ({
      id: `chat:${chat.id}`,
      icon: 'message-square',
      kind: t('streamB.chat.460b3a'),
      title: chat.title,
      note: [where, chat.when].filter(Boolean).join(' · '),
    }))
  const items = model.folders.value.flatMap((folder) =>
    folder.git
      ? folder.copies.flatMap((copy) => [
          {
            id: copy.id,
            // A worktree gone from disk says so by its glyph and in its tooltip, as everywhere.
            icon: copyIcon(copy),
            kind: copyKind(copy),
            title: `${folder.name} / ${copy.branch}`,
            note: copy.path,
            ...(copy.changed
              ? { count: { value: copy.changed, label: t('streamB.changedFiles.4743a8') } }
              : {}),
            current: copy.id === model.selected.value,
          },
          ...chats(copy.chats, `${folder.name} / ${copy.branch}`),
        ])
      : [
          {
            id: folder.id,
            icon: 'folder',
            kind: t('streamB.folder.74ccd4'),
            title: folder.name,
            note: folder.path,
            current: folder.id === model.selected.value,
          },
          ...chats(folder.chats, folder.name),
        ]
  )
  new NodeSuggestModal(
    app(),
    items,
    node?.label != null
      ? t('streamB.folderBranchOrChatOn.4055f1', { v0: node.label })
      : t('streamBMeta.6e72d9e69a'),
    (item) =>
      item.id.startsWith('chat:')
        ? openChat(item.id.slice(5))
        : nodePathAction(() => model.select(item.id)),
    t('streamB.noFolderOrBranchMatches.5b24c7')
  ).open()
}
/**
 * Compare with…: every branch, remote branch and tag the worktree can be set against. The
 * branch's codes and its committed changes then count against the one chosen.
 */
export function chooseNodePathBase(model: NodePathModel): void {
  nodePathAction(async () => {
    if (!model.panelBranch.value) await model.loadPanelBranch()
    const branch = model.panelBranch.value
    if (!branch) throw new UiError(uiMessage('streamB.thisPlaceHasNoBranchToCompare.4b54f1'))
    const kind = (ref: string) =>
      ref.startsWith('refs/tags/')
        ? { icon: 'tag', kind: t('streamB.pickerTag') }
        : ref.startsWith('refs/remotes/')
          ? { icon: 'cloud', kind: t('streamB.pickerRemoteBranch') }
          : { icon: 'git-branch', kind: t('streamB.branch.52656e') }
    new NodeSuggestModal(
      app(),
      branch.refs.map((ref) => ({
        id: ref,
        ...kind(ref),
        title: shortRef(ref),
        current: ref === (model.panelBase.value || branch.state.baseRef),
      })),
      t('streamB.compareWithABranchOrTag.a6c277'),
      (item) => {
        model.panelBase.value = item.id
        model.panelMode.value = 'changes'
      },
      t('streamB.noBranchOrTagMatches.f98366')
    ).open()
  })
}
/**
 * The place's menu: what stood as glyphs in the panel's header (new chat, open a folder,
 * refresh), switching place, then what can be done with this folder or worktree, then the node.
 */
export function showNodePathPlaceMenu(
  model: NodePathModel,
  event: MouseEvent,
  openChat: (id: string) => void
): void {
  const at = position(event)
  const target = model.current.value && { ...model.current.value }
  const online =
    NodeService.getInstance().connection(model.registrationId).state.value === 'connected'
  const menu = new Menu()
  const tail = (m: Menu) => {
    m.addSeparator()
    m.addItem((i) =>
      i
        .setTitle(t('streamB.openAFolder.d0a43e'))
        .setIcon('folder-plus')
        .setDisabled(!online)
        .onClick(() => nodePathAction(() => openFolderForNode(model)))
    )
    m.addItem((i) =>
      i
        .setTitle(t('streamB.refresh.0e9161'))
        .setIcon('refresh-cw')
        .onClick(() =>
          nodePathAction(() =>
            NodeService.getInstance()
              .connection(model.registrationId)
              .connect()
              .then(() => model.refreshCurrent())
          )
        )
    )
    m.addSeparator()
    nodePathAction(async () => {
      await nodeItems(model, m, target ?? undefined, !target)
      m.showAtPosition(at)
    })
  }
  const id = model.selected.value
  if (!id || !model.current.value) return tail(menu)
  const git = model.currentFolder.value?.git ?? false
  menu.addItem((i) =>
    i
      .setTitle(t('streamB.newChatHere.f62c3c'))
      .setIcon('message-square-plus')
      .setDisabled(!online || !model.capabilities.value.includes('node_path_execution'))
      .onClick(() => nodePathAction(() => newNodePathChat(model)))
  )
  menu.addItem((i) =>
    i
      .setTitle(
        git ? t('streamB.switchToAnotherBranch.b4d908') : t('streamB.chooseAnotherFolder.13df5b')
      )
      .setIcon(git ? 'git-branch' : 'folder')
      .onClick(() => pickNodePathPlace(model, openChat))
  )
  if (git && model.port.git && model.current.value.kind === 'worktree')
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.fetchFromTheRemote.0b0ee5'))
        .setIcon('cloud-download')
        .setDisabled(!online || !!model.gitBusy.value)
        .onClick(() => nodePathAction(() => model.fetch()))
    )
  if (git && model.current.value.kind === 'worktree')
    menu.addItem((i) =>
      i
        .setTitle(t('streamB.compareWith.b33c54'))
        .setIcon('git-compare')
        .setDisabled(!model.port.branch)
        .onClick(() => chooseNodePathBase(model))
    )
  withRowMenu(model, id, tail, menu, true)
}
