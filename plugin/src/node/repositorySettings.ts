import type { NodeClient } from '@abele/node-client'
import type { RepositorySource } from '@/repository/source'
import type { confirmAction } from '@/modal/confirm'

type ConfirmOptions = Parameters<typeof confirmAction>[1]

/** What the person is asked before a project's other worktrees are opened to browsing, or closed. */
export const externalBrowsingConfirm = (enabled: boolean): ConfirmOptions => ({
  title: 'External workspace browsing',
  message: enabled
    ? 'Allow this project’s other Git worktrees to be browsed by confirmed node owners? They remain read only. This does not allow agent execution or editing.'
    : 'Stop browsing external workspaces for this project? Open external views and retained reads lose access.',
  confirmText: enabled ? 'Allow browsing' : 'Stop browsing',
  confirmTooltip: enabled
    ? 'Allow read-only browsing of external workspaces'
    : 'Stop external workspace reads',
})

/** Owner UI only: project browsing opt-in is distinct from agent grants and provider admission. */
export async function changeExternalBrowsing(
  client: Pick<NodeClient, 'setRepositorySettings'>,
  source: RepositorySource,
  enabled: boolean,
  confirm: () => Promise<boolean>
): Promise<boolean> {
  source.assertCurrent()
  if (source.identity.provider !== 'node') throw new Error('Select a node repository first.')
  const project = source.identity.project
  if (!(await confirm())) return false
  source.assertCurrent()
  await client.setRepositorySettings({ project_id: project, external_read: enabled })
  source.refresh?.()
  return true
}

/** The same opt-in from the node's side panel, where a project is known by its id alone. */
export async function changeProjectExternalBrowsing(
  client: Pick<NodeClient, 'setRepositorySettings'>,
  project: string,
  enabled: boolean,
  confirm: () => Promise<boolean>
): Promise<boolean> {
  if (!(await confirm())) return false
  await client.setRepositorySettings({ project_id: project, external_read: enabled })
  return true
}
