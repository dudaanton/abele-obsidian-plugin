import { UiError, uiMessage } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import type { NodeClient } from '@abele/node-client'
import type { RepositorySource } from '@/repository/source'
import type { confirmDialog } from '@/components/obsidian/dialogs'

type ConfirmOptions = Parameters<typeof confirmDialog>[0]

/** What the person is asked before a project's other worktrees are opened to browsing, or closed. */
export const externalBrowsingConfirm = (enabled: boolean): ConfirmOptions => ({
  title: t('streamB.externalWorkspaceBrowsing.5db838'),
  message: enabled
    ? t('streamB.allowThisProjectSOtherGitWorktrees.82c5e5')
    : t('streamB.stopBrowsingExternalWorkspacesForThisProject.6c1610'),
  confirmText: enabled ? t('streamB.allowBrowsing.faa6e2') : t('streamB.stopBrowsing.5698d3'),
  confirmTooltip: enabled
    ? t('streamB.allowReadOnlyBrowsingOfExternalWorkspaces.1e6e32')
    : t('streamB.stopExternalWorkspaceReads.930da5'),
})

/** Owner UI only: project browsing opt-in is distinct from agent grants and provider admission. */
export async function changeExternalBrowsing(
  client: Pick<NodeClient, 'setRepositorySettings'>,
  source: RepositorySource,
  enabled: boolean,
  confirm: () => Promise<boolean>
): Promise<boolean> {
  source.assertCurrent()
  if (source.identity.provider !== 'node')
    throw new UiError(uiMessage('streamB.selectANodeRepositoryFirst.643b80'))
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

/**
 * Whether the project's other worktrees are open to browsing, as the node reports it. A node too
 * old to say, or one slow to answer, leaves it unknown: the menu then shows the switch unchecked.
 */
export async function projectExternalBrowsing(
  client: Pick<NodeClient, 'request'>,
  project: string,
  wait = 1500
): Promise<boolean | undefined> {
  let timer: number | undefined
  try {
    const answer = await Promise.race([
      client.request('project.repository_settings.get', { project_id: project }),
      new Promise<undefined>((resolve) => (timer = window.setTimeout(resolve, wait))),
    ])
    const enabled = (answer as { external_read?: unknown } | undefined)?.external_read
    return typeof enabled === 'boolean' ? enabled : undefined
  } catch (error) {
    console.debug('[Abele] node did not report external workspace browsing', error)
    return undefined
  } finally {
    window.clearTimeout(timer)
  }
}
