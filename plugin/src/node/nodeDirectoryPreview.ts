import type { NodeClient } from '@abele/node-client'
import { ChannelError } from '@abele/channel-protocol'
import { t } from '@/i18n'
import type { ConfirmationDetails } from '@/components/obsidian/confirmationDetails'
import type { PathTarget } from './NodePathModel'
import { pathPages } from './NodePathClientPort'

export async function directoryPreview(
  client: Pick<NodeClient, 'repository'>,
  target: PathTarget,
  path: string,
  entries: { path: string; kind: 'file' | 'directory' }[]
) {
  const files = entries.filter((entry) => entry.kind === 'file')
  const badges = new Map<string, string>()
  try {
    if (target.kind === 'worktree') {
      const { revision } = await client.repository.observe({ worktree_id: target.id })
      const status = await pathPages((cursor) =>
        client.repository.status({ worktree_id: target.id, revision, cursor })
      )
      const changes = new Map(status.map((row) => [row.path, row]))
      const tracked = new Set<string>()
      const head = revision.kind === 'working' ? revision.head : revision.commit
      if (head) {
        const parents = new Set(
          files.map((entry) => `${path}/${entry.path}`.split('/').slice(0, -1).join('/'))
        )
        for (const parent of parents) {
          try {
            const rows = await pathPages((cursor) =>
              client.repository.tree({
                worktree_id: target.id,
                revision: { kind: 'commit', commit: head },
                path: parent,
                cursor,
              })
            )
            for (const row of rows) if (row.kind === 'file') tracked.add(row.path)
          } catch (error) {
            if (!(error instanceof ChannelError) || error.code !== 'not_found') throw error
          }
        }
      }
      for (const entry of files) {
        const full = `${path}/${entry.path}`
        const change = changes.get(full)
        if (change && (change.index !== ' ' || change.worktree !== ' '))
          badges.set(
            entry.path,
            t(
              change.index === '?' || change.worktree === '?'
                ? 'node.files.untracked'
                : 'node.files.uncommitted'
            )
          )
        else if (!tracked.has(full)) badges.set(entry.path, t('node.files.untracked'))
      }
    } else for (const entry of files) badges.set(entry.path, t('node.files.untracked'))
  } catch (error) {
    console.debug('[Abele] directory preview: Git status unavailable', error)
    for (const entry of files) badges.set(entry.path, t('node.files.gitStatusUnavailable'))
  }
  const details: ConfirmationDetails = {
    label: t('node.files.showFiles'),
    notice: badges.size ? t('node.files.gitRecoveryWarning') : undefined,
    items: entries
      .filter((entry) => entry.path)
      .map((entry) => ({
        path: entry.path + (entry.kind === 'directory' ? '/' : ''),
        folder: entry.kind === 'directory',
        badge: badges.get(entry.path),
      })),
  }
  return {
    files: files.length,
    folders: entries.filter((entry) => entry.kind === 'directory').length,
    details,
  }
}
