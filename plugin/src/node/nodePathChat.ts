import { SessionTargetChangedSchema, type ExecutionTarget } from '@abele/node-protocol'
import type { JournalEvent } from '@abele/channel-protocol'
import type { ChatMessage } from '@/ai/types'
import type { PathTarget } from './NodePathModel'
export const wirePathTarget = (target: PathTarget): ExecutionTarget =>
  target.kind === 'worktree'
    ? { kind: 'worktree', worktree_id: target.id }
    : { kind: 'workspace', workspace_id: target.id }
export const bindPathTarget = (
  identity: Pick<PathTarget, 'nodeId' | 'registrationId'>,
  projectId: string,
  wire: ExecutionTarget
): PathTarget => ({
  ...identity,
  projectId,
  kind: wire.kind,
  id: wire.kind === 'worktree' ? wire.worktree_id : wire.workspace_id,
})
export interface NodeChatSwitch {
  seq: number
  at: number
  from: PathTarget
  to: PathTarget
  branch: string
  by: 'agent' | 'you'
}
export function nodeChatSwitches(
  events: readonly JournalEvent[],
  identity: PathTarget,
  sessionId: string,
  label: (id: string) => string,
  inherited = false
): NodeChatSwitch[] {
  const seen = new Set<number>(),
    switches: NodeChatSwitch[] = []
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (
      (!inherited && event.stream_id !== sessionId) ||
      event.type !== 'session.worktree.changed' ||
      seen.has(event.seq)
    )
      continue
    seen.add(event.seq)
    const parsed = SessionTargetChangedSchema.safeParse(event.data)
    if (
      !parsed.success ||
      parsed.data.session_id !== event.stream_id ||
      parsed.data.project_id !== identity.projectId
    )
      continue
    const data = parsed.data,
      to = bindPathTarget(identity, data.project_id, data.to)
    switches.push({
      seq: event.seq,
      at: Date.parse(event.at),
      from: bindPathTarget(identity, data.project_id, data.from),
      to,
      branch: label(to.id),
      by: data.by === 'agent' ? 'agent' : 'you',
    })
  }
  return switches
}
export function nodeChatSegments(
  messages: ChatMessage[],
  sequences: Record<string, number> | undefined,
  switches: NodeChatSwitch[],
  current?: PathTarget
): { messages: ChatMessage[]; target?: PathTarget; switch?: NodeChatSwitch }[] {
  const segments = [
    { messages: [] as ChatMessage[], target: switches[0]?.from ?? current },
    ...switches.map((move) => ({ messages: [] as ChatMessage[], target: move.to, switch: move })),
  ]
  for (const message of messages) {
    const sequence = sequences?.[message.id]
    let index = 0
    for (const move of switches) {
      if (sequence !== undefined ? sequence > move.seq : message.timestamp > move.at) index++
      else break
    }
    segments[index].messages.push(message)
  }
  return segments
}
