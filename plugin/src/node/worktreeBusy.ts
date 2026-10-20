import { ChannelError } from '@abele/channel-protocol'
import type { PathTarget, NodePathModel } from './NodePathModel'
import { t } from '@/i18n'

/** Busy is an active lease, not a quota. Node details may also identify non-chat holders. */
export function worktreeBusy(error: unknown, model: NodePathModel, target: PathTarget) {
  const busy =
    error instanceof ChannelError
      ? error.code === 'resource_busy'
      : error instanceof Error && /\bresource_busy\b/.test(error.message)
  if (!busy) return undefined
  const sessions = model.sessions.value
    .filter((row) => row.target?.id === target.id && row.target.projectId === target.projectId)
    .map((row) => ({ id: row.session.session_id, title: row.session.title }))
  const details = error instanceof ChannelError ? error.details : undefined
  if (
    typeof details?.session_id === 'string' &&
    typeof details.title === 'string' &&
    !sessions.some((s) => s.id === details.session_id)
  )
    sessions.push({ id: details.session_id, title: details.title })
  const holders = Array.isArray(details?.holders)
    ? details.holders.flatMap((holder: unknown) => {
        if (typeof holder === 'string') return [holder]
        if (
          holder &&
          typeof holder === 'object' &&
          'label' in holder &&
          typeof holder.label === 'string'
        )
          return [holder.label]
        return []
      })
    : details?.holder === 'git_lock'
      ? [t('node.files.gitLock')]
      : []
  return { sessions, labels: [...new Set([...sessions.map((s) => s.title), ...holders])] }
}
