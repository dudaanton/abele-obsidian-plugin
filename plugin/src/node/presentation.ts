import { t } from '@/i18n'
import type { Job } from '@abele/node-client'
import type { ChatMessage } from '@/ai/types'
import { readAgentReplyText } from '@/ai/replyLinks'

export function shortNodePath(path: string, width = 40): string {
  const chars = Array.from(path)
  if (chars.length <= width) return path
  const start = Math.min(12, Math.floor((width - 1) / 3))
  return chars.slice(0, start).join('') + '…' + chars.slice(-(width - start - 1)).join('')
}
export function nodeJobLabel(job: Job): string {
  const creating = job.kind === 'workspace.create'
  if (job.state === 'succeeded')
    return creating ? t('streamB.workspaceCreated.246b46') : t('streamB.workspaceRemoved.942308')
  if (job.state === 'needs_attention' || job.state === 'failed')
    return creating
      ? t('streamB.workspaceCreationNeedsAttention.be51f9')
      : t('streamB.workspaceRemovalNeedsAttention.89fa4e')
  if (job.state === 'queued')
    return creating
      ? t('streamB.waitingToCreateWorkspace.f65232')
      : t('streamB.waitingToRemoveWorkspace.c2e5f2')
  if (!creating) return t('streamB.removingWorkspace.0e65ca')
  if (job.phase === 'branch_created') return t('streamB.preparingWorktreeFiles.5544f7')
  if (job.phase === 'worktree_created') return t('streamB.finishingWorkspaceSetup.b25c56')
  return t('streamB.creatingWorkspaceBranch.549f3c')
}
export const workspaceStateLabels = {
  get provisioning() {
    return t('streamB.creating.3b951e')
  },
  get ready() {
    return t('streamB.ready.5fa7aa')
  },
  get removing() {
    return t('streamB.removing.9f2c59')
  },
  get removed() {
    return t('streamB.removed.4118fb')
  },
  get needs_attention() {
    return t('streamB.needsAttention.c1ebc7')
  },
}
export function promptExpiry(expires: number | undefined, now: number): string {
  if (!Number.isFinite(expires)) return ''
  const remaining = expires - now
  if (remaining > 10 * 60000) return ''
  if (remaining <= 0) return t('streamB.expiryDue.3efa11')
  if (remaining < 60000) return t('streamB.expiresInLessThanAMinute.5ff634')
  return t('streamB.expiresInMin.5e064b', { v0: String(Math.ceil(remaining / 60000)) })
}
export interface QueueState {
  label: string
  inputId?: string
}
export interface NodeQueueView {
  messages: ChatMessage[]
  states: Record<string, QueueState>
}

/** A queued input as the person wrote it: a reply's links back to its words and places. */
function queuedQuestion(text: string): Pick<ChatMessage, 'content' | 'replyTo'> {
  const replied = readAgentReplyText(text)
  return replied ? { content: replied.content, replyTo: replied.replyTo } : { content: text }
}

/** Receipt identity joins device outbox and journal inputs. Never deduplicate by text. */
export function nodeQueueView(
  messages: readonly ChatMessage[],
  device: readonly { id: string; text: string }[],
  node: readonly { id: string; text: string }[],
  receipts: Record<string, { result?: unknown }>
): NodeQueueView {
  const operations = new Map<string, string>()
  for (const [operation, receipt] of Object.entries(receipts)) {
    const data = receipt.result as { input_id?: unknown; accepted_seq?: unknown } | undefined
    if (data && typeof data.input_id === 'string' && Number.isSafeInteger(data.accepted_seq))
      operations.set(data.input_id, operation)
  }
  const key = (input: string) =>
    operations.has(input) ? `operation:${operations.get(input)}` : `input:${input}`
  const shown = messages.map((m) =>
    m.id.startsWith('input:') ? { ...m, id: key(m.id.slice(6)) } : m
  )
  const states: NodeQueueView['states'] = {}
  const ids = new Set(shown.map((m) => m.id))
  for (const queued of node) {
    const id = key(queued.id)
    if (!ids.has(id)) {
      shown.push({ id, role: 'user', ...queuedQuestion(queued.text), timestamp: 0 })
      ids.add(id)
    }
    states[id] = { label: t('streamB.queued.661ff4'), inputId: queued.id }
  }
  for (const queued of device) {
    const id = `operation:${queued.id}`
    if (ids.has(id)) continue
    shown.push({ id, role: 'user', ...queuedQuestion(queued.text), timestamp: 0 })
    states[id] = { label: t('streamB.queuedOnThisDevice.49559a') }
    ids.add(id)
  }
  return { messages: shown, states }
}
/** A ref as people say it: `main` for a branch, `origin/main` for a remote's, a tag by its name. */
export const shortRef = (ref: string) => ref.replace(/^refs\/(heads|remotes|tags)\//, '')
