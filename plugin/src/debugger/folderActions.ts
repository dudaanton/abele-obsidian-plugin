import { Menu, Notice, type MenuItem, type Plugin } from 'obsidian'
import { t } from '@/i18n'
import { NodeService } from '@/node/NodeService'
import { NodePathService } from '@/node/NodePathService'
import type { PathTarget } from '@/node/NodePathModel'
import { NodePathTabSchema } from '@/node/nodePathNavigation'
import { nodeDebuggerSupported } from '@/node/providers'
import { GlobalStore } from '@/stores/GlobalStore'
import { debugOwnerParams, type FolderDebugOwner } from './owner'
import { startNodeProgram, attachNodeProgram, openNodeDebugger } from './register'

export function folderOwner(target: PathTarget): FolderDebugOwner {
  return {
    kind: 'folder-debug',
    target: { ...target },
    connection: NodeService.getInstance().connection(target.registrationId),
  }
}

/** Read-only extension negotiation: node protocol 0.1 has no separate advertised owner bit. */
export async function folderDebugReason(owner: FolderDebugOwner): Promise<string> {
  if (owner.connection.state.value !== 'connected') return t('debug.offline')
  const client = owner.connection.client
  try {
    if (!nodeDebuggerSupported(await client.describe())) return t('debug.off')
    try {
      await client.request('debugger.v1.sessions', { ...debugOwnerParams(owner), limit: 1 })
    } catch (error) {
      console.debug('[debugger] Folder ownership unavailable', error)
      const message = error instanceof Error ? error.message : String(error)
      return /invalid_params|invalid_request|unsupported_method|conversation_id|validation/i.test(
        message
      )
        ? t('debug.update')
        : owner.connection.state.value !== 'connected'
          ? t('debug.offline')
          : message
    }
    const profiles = await client.request('debugger.v1.profiles', {})
    if (
      !Array.isArray(profiles) ||
      !profiles.some((profile: { id?: string }) => profile?.id === 'js-ts-native')
    )
      return t('debug.install')
    return owner.connection.state.value === 'connected' ? '' : t('debug.offline')
  } catch (error) {
    console.debug('[debugger] Folder availability unavailable', error)
    return error instanceof Error ? error.message : t('debug.off')
  }
}

type Action = 'open' | 'run' | 'attach'
const titles = {
  open: () => t('debug.open'),
  run: () => t('debug.run'),
  attach: () => t('debug.attach'),
}
export async function runFolderDebug(
  target: PathTarget,
  action: Action,
  program?: string
): Promise<void> {
  try {
    const owner = folderOwner(target)
    const reason = await folderDebugReason(owner)
    if (reason) {
      new Notice(reason)
      return
    }
    const authorize = async () => {
      const { approveNodePathExecution } = await import('@/node/NodePathController')
      return approveNodePathExecution(
        NodePathService.getInstance().model(target.registrationId),
        target,
        'debugger'
      )
    }
    if (action === 'open') {
      await openNodeDebugger(owner, authorize)
      return
    }
    if (!(await authorize())) return
    if (action === 'attach') await attachNodeProgram(owner)
    else if (program) {
      const { startProgram, openFilesOf } = await import('./startProgram')
      const { showSession } = await import('./register')
      await startProgram(
        owner,
        program,
        openFilesOf(GlobalStore.getInstance().app.workspace, target),
        target,
        (id) => showSession(owner, id)
      )
    } else await startNodeProgram(owner)
  } catch (error) {
    console.debug('[debugger] Folder action failed', error)
    new Notice(error instanceof Error ? error.message : t('debug.off'))
  }
}

/** Native rows are present while support is checked, including on an old or offline node. */
export function addFolderDebugMenu(menu: Menu, target?: PathTarget, program?: string): void {
  target = target && Object.freeze({ ...target })
  const rows: { item: MenuItem; action: Action }[] = []
  for (const [action, icon] of [
    ['open', 'bug-play'],
    ['run', 'play'],
    ['attach', 'plug'],
  ] as const) {
    menu.addItem((item) => {
      rows.push({ item, action })
      item
        .setTitle(`${titles[action]()} — ${target ? t('debug.checking') : t('debug.noFolder')}`)
        .setIcon(icon)
        .setDisabled(true)
      item.onClick(() => {
        if (target)
          void runFolderDebug(
            target,
            action,
            program && /\.[cm]?js$/.test(program) ? program : undefined
          )
      })
    })
  }
  if (!target) return
  const owner = folderOwner(target)
  void folderDebugReason(owner).then((reason) => {
    for (const { item, action } of rows)
      item
        .setTitle(reason ? `${titles[action]()} — ${reason}` : titles[action]())
        .setDisabled(!!reason)
  })
}

/** The active file's folder first, otherwise the place selected in the node panel. */
function commandTarget(): PathTarget | undefined {
  const workspace = GlobalStore.getInstance().app.workspace
  const active = workspace.getMostRecentLeaf()?.getViewState()
  if (active?.type === 'abele-node-file') {
    const parsed = NodePathTabSchema.safeParse(active.state)
    if (parsed.success) return parsed.data.target
  }
  const leaf = workspace.getLeavesOfType('abele-node-sidebar')[0]
  const registrationId = (leaf?.getViewState().state as { registrationId?: string } | undefined)
    ?.registrationId
  return registrationId
    ? (NodePathService.getInstance().model(registrationId).current.value ?? undefined)
    : undefined
}
export function registerFolderDebugCommands(plugin: Plugin): void {
  const callback = (action: 'open' | 'run' | 'attach') => () => {
    const target = commandTarget()
    if (target) void runFolderDebug(target, action)
    else new Notice(t('debug.noFolder'))
  }
  // Each name is a literal t() call so the command reference test can resolve it.
  plugin.addCommand({
    id: 'node-folder-debug-open',
    name: t('debug.open'),
    callback: callback('open'),
  })
  plugin.addCommand({
    id: 'node-folder-debug-run',
    name: t('debug.run'),
    callback: callback('run'),
  })
  plugin.addCommand({
    id: 'node-folder-debug-attach',
    name: t('debug.attach'),
    callback: callback('attach'),
  })
}
