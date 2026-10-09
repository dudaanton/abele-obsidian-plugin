import type { NodeClient } from '@abele/node-client'
import type { RepositorySource } from '@/repository/source'
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
