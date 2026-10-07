import type { Job } from '@abele/node-client'
import type { ChatMessage } from '@/ai/types'

export function shortNodePath(path: string, width = 40): string {
  const chars = Array.from(path)
  if (chars.length <= width) return path
  const start = Math.min(12, Math.floor((width - 1) / 3))
  return chars.slice(0, start).join('') + '…' + chars.slice(-(width - start - 1)).join('')
}
export function nodeJobLabel(job: Job): string {
  const creating = job.kind === 'workspace.create'
  if (job.state === 'succeeded') return creating ? 'Workspace created' : 'Workspace removed'
  if (job.state === 'needs_attention' || job.state === 'failed')
    return creating ? 'Workspace creation needs attention' : 'Workspace removal needs attention'
  if (job.state === 'queued')
    return creating ? 'Waiting to create workspace…' : 'Waiting to remove workspace…'
  if (!creating) return 'Removing workspace…'
  if (job.phase === 'branch_created') return 'Preparing worktree files…'
  if (job.phase === 'worktree_created') return 'Finishing workspace setup…'
  return 'Creating workspace branch…'
}
export const workspaceStateLabels = {
  provisioning: 'Creating',
  ready: 'Ready',
  removing: 'Removing',
  removed: 'Removed',
  needs_attention: 'Needs attention',
}
export function promptExpiry(expires: number | undefined, now: number): string {
  if (!Number.isFinite(expires)) return ''
  const remaining = expires! - now
  if (remaining > 10 * 60000) return ''
  if (remaining <= 0) return 'Expiry due'
  if (remaining < 60000) return 'Expires in less than a minute'
  return `Expires in ${Math.ceil(remaining / 60000)} min`
}
export interface QueueState {
  label: string
  inputId?: string
}
export interface NodeQueueView {
  messages: ChatMessage[]
  states: Record<string, QueueState>
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
      shown.push({ id, role: 'user', content: queued.text, timestamp: 0 })
      ids.add(id)
    }
    states[id] = { label: 'Queued', inputId: queued.id }
  }
  for (const queued of device) {
    const id = `operation:${queued.id}`
    if (ids.has(id)) continue
    shown.push({ id, role: 'user', content: queued.text, timestamp: 0 })
    states[id] = { label: 'Queued on this device' }
    ids.add(id)
  }
  return { messages: shown, states }
}
