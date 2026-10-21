import { Menu, Notice, type Plugin } from 'obsidian'
import { watch } from 'vue'
import { t } from '@/i18n'
import { NodeService } from '@/node/NodeService'
import { NodePathService } from '@/node/NodePathService'
import type { PathTarget } from '@/node/NodePathModel'
import { NodePathTabSchema } from '@/node/nodePathNavigation'
import { nodeDebuggerSupported } from '@/node/providers'
import { nodeErrorWords } from '@/node/errorWords'
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
  const generation = owner.connection.authorizationGeneration
  const identity = JSON.stringify(client.target)
  let interrupted = false
  let replaced = false
  const stop = watch(
    owner.connection.state,
    (state) => {
      interrupted = true
      if (state !== 'offline') replaced = true
    },
    { flush: 'sync' }
  )
  // Going offline invalidates success, but its failure still explains this attempt.
  // A new connection attempt invalidates errors from the previous peer as well.
  const samePeer = () =>
    !replaced &&
    generation === owner.connection.authorizationGeneration &&
    identity === JSON.stringify(client.target)
  const current = () => !interrupted && owner.connection.state.value === 'connected' && samePeer()
  try {
    const description = await client.describe()
    if (!current()) return t('debug.offline')
    if (!nodeDebuggerSupported(description)) return t('debug.off')
    try {
      await client.request('debugger.v1.sessions', { ...debugOwnerParams(owner), limit: 1 })
    } catch (error) {
      console.debug('[debugger] Folder ownership unavailable', error)
      const message = (error instanceof Error ? error.message : String(error)) || t('debug.off')
      if (!samePeer()) return t('debug.offline')
      return /invalid_params|invalid_request|unsupported_method|conversation_id|validation/i.test(
        message
      )
        ? t('debug.update')
        : message
    }
    if (!current()) return t('debug.offline')
    const profiles = await client.request('debugger.v1.profiles', {})
    if (!current()) return t('debug.offline')
    if (
      !Array.isArray(profiles) ||
      !profiles.some((profile: { id?: string }) => profile?.id === 'js-ts-native')
    )
      return t('debug.install')
    return ''
  } catch (error) {
    console.debug('[debugger] Folder availability unavailable', error)
    return !samePeer()
      ? t('debug.offline')
      : (error instanceof Error && error.message) || t('debug.off')
  } finally {
    stop()
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

/** Callers must await readiness before showing a native menu, which snapshots its rows. */
export async function addFolderDebugMenu(
  menu: Menu,
  target?: PathTarget,
  program?: string
): Promise<void> {
  target = target && Object.freeze({ ...target })
  const reason = target ? await folderDebugReason(folderOwner(target)) : t('debug.noFolder')
  for (const [action, icon] of [
    ['open', 'bug-play'],
    ['run', 'play'],
    ['attach', 'plug'],
  ] as const) {
    menu.addItem((item) => {
      item
        .setTitle(reason ? `${titles[action]()} — ${reason}` : titles[action]())
        .setIcon(icon)
        .setDisabled(!!reason)
      item.onClick(() => {
        if (target)
          void runFolderDebug(
            target,
            action,
            program && /\.[cm]?[jt]s$/.test(program) ? program : undefined
          )
      })
    })
  }
}

async function availableCommandFolder(paths: NodePathService, registrationId: string) {
  const model = paths.model(registrationId)
  if (model.current.value) return model.current.value
  let stop = () => {}
  try {
    // Startup selects the folder before reading its tree. The command needs that identity,
    // not a completed listing (which can keep changing while programs record).
    const selected = new Promise<void>((resolve) => {
      stop = watch(
        model.current,
        (current) => {
          if (current) resolve()
        },
        {
          immediate: true,
          flush: 'sync',
        }
      )
    })
    await Promise.race([paths.ready(registrationId), selected])
    return model.current.value
  } finally {
    stop()
  }
}

/** The active file's folder first, otherwise the place selected in the node panel. */
export async function commandTarget(): Promise<PathTarget | undefined> {
  const workspace = GlobalStore.getInstance().app.workspace
  const active = workspace.getMostRecentLeaf()?.getViewState()
  if (active?.type === 'abele-node-file') {
    const parsed = NodePathTabSchema.safeParse(active.state)
    if (
      parsed.success &&
      NodeService.getInstance().nodes.value.some(
        (node) =>
          node.id === parsed.data.target.registrationId &&
          node.expectedNodeId === parsed.data.target.nodeId
      )
    )
      return parsed.data.target
  }
  const leaf = workspace.getLeavesOfType('abele-node-sidebar')[0]
  const registrationId = (leaf?.getViewState().state as { registrationId?: string } | undefined)
    ?.registrationId
  const paths = NodePathService.getInstance()
  if (registrationId) {
    const current = await availableCommandFolder(paths, registrationId)
    if (current) return current
  }
  // Commands are available before the sidebar creates a path model. Restore its remembered
  // folder and load the node's folders when this device has no remembered selection yet.
  for (const node of NodeService.getInstance().nodes.value) {
    const target = await availableCommandFolder(paths, node.id)
    if (target) return target
  }
  return undefined
}
export function registerFolderDebugCommands(plugin: Plugin): void {
  const callback = (action: 'open' | 'run' | 'attach') => async () => {
    try {
      const target = await commandTarget()
      if (target) await runFolderDebug(target, action)
      else new Notice(t('debug.noFolder'))
    } catch (error) {
      console.debug('[debugger] Folder command unavailable', error)
      new Notice(error instanceof Error ? nodeErrorWords(error.message) : t('debug.noFolder'))
    }
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
