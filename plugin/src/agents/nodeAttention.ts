import { presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { nodePages } from '@/node/nodePages'
import type { JournalEvent } from '@abele/channel-protocol'
import type { AttentionReason, AttentionRow } from './attention'
import type { DelegationCard } from '@/node/delegation'

/** What the agents list needs from a node: the session list, each one's state, its open prompts. */
export interface NodeAttentionPort {
  onEvent?(listener: (event: JournalEvent) => void): () => void
  listSessions(after?: string): Promise<
    {
      session_id: string
      title: string
      provider: string
      settings?: { model?: string }
    }[]
  >
  sessionState(session_id: string): Promise<{
    live: boolean
    process: string
    turn: { turn_id: string; started_at: string } | null
    compacting: boolean
  }>
  prompts(
    session_id: string,
    after?: string,
    state?: 'pending'
  ): Promise<{ prompt_id: string; kind?: string; title?: string; tool_name?: string }[]>
}
export interface NodeAttentionTarget {
  id: string
  label: string
  expectedNodeId: string
}

const AGENTS: Record<string, string> = {
  claude: 'Claude',
  pi: 'pi',
  codex: 'Codex',
  get fake() {
    return t('streamB.fake.84561d')
  },
}
/** Enough to keep a busy list moving, few enough not to crowd the node's channel. */
const PARALLEL = 6

/** Finite developers need not have a long-lived process or turn in session.state. */
export function delegationAttentionRows(
  cards: DelegationCard[],
  node: NodeAttentionTarget
): AttentionRow[] {
  return cards
    .filter((card) => card.sessionId)
    .map((card) => {
      const kind: AttentionReason['kind'] = card.pendingHumanPrompts
        ? 'approval'
        : card.state === 'running'
          ? 'running'
          : card.state === 'completed'
            ? 'done'
            : ['failed', 'unknown', 'cancelled', 'stopped'].includes(card.state)
              ? 'interrupted'
              : 'delivery'
      return {
        key: `node:${node.id}:${card.sessionId}`,
        reference: {
          kind: 'node',
          registrationId: node.id,
          nodeId: node.expectedNodeId,
          sessionId: card.sessionId!,
        },
        title: card.title,
        agent: AGENTS[card.provider] ?? card.provider,
        source: t('streamB.node.01630d', { v0: node.label }),
        folder: card.branch,
        reasons: [
          {
            kind,
            id: `delegation:${card.delegationId}`,
            at: 0,
            text: card.pendingHumanPrompts
              ? t('streamBMeta.1f8e74f453', { p0: String(card.pendingHumanPrompts) })
              : kind === 'done'
                ? t('node.delegation.done')
                : card.activity?.tool,
          },
        ],
      }
    })
}

/**
 * One row per session that waits for the owner or works. A session that cannot be read is
 * counted, never allowed to hide the others; only a failed list fails the whole node.
 */
export async function readNodeAttention(
  port: NodeAttentionPort,
  node: NodeAttentionTarget
): Promise<{ rows: AttentionRow[]; unreadable: number }> {
  const sessions = await nodePages(
    (after) => port.listSessions(after),
    (s) => s.session_id
  )
  const rows: AttentionRow[] = []
  let unreadable = 0
  const read = async (session: (typeof sessions)[number]) => {
    try {
      const state = await port.sessionState(session.session_id)
      const at = Date.parse(state.turn?.started_at ?? '') || 0
      const reasons: AttentionReason[] = []
      // Prompts exist only while a process runs; an idle session costs one request.
      if (state.live || state.turn || state.process !== 'none')
        for (const prompt of await nodePages(
          (after) => port.prompts(session.session_id, after, 'pending'),
          (prompt) => prompt.prompt_id
        ))
          reasons.push({
            kind:
              !prompt.kind || ['permission', 'trust'].includes(prompt.kind)
                ? 'approval'
                : 'question',
            id: prompt.prompt_id,
            at,
            text: prompt.tool_name ?? prompt.title,
          })
      if (state.turn || state.compacting)
        reasons.push({ kind: 'running', id: state.turn?.turn_id ?? 'compacting', at })
      if (!reasons.length) return
      rows.push({
        key: `node:${node.id}:${session.session_id}`,
        reference: {
          kind: 'node',
          registrationId: node.id,
          nodeId: node.expectedNodeId,
          sessionId: session.session_id,
        },
        title: session.title || t('streamB.untitledSession.3d9b66'),
        agent: AGENTS[session.provider] ?? session.provider,
        model: session.settings?.model || undefined,
        source: t('streamB.node.01630d', { v0: String(node.label) }),
        reasons,
        updatedAt: Date.now(),
      })
    } catch (error) {
      unreadable++
      console.debug('[Abele agents] node session unreadable', {
        session: session.session_id,
        error: presentUiError(error),
      })
    }
  }
  for (let i = 0; i < sessions.length; i += PARALLEL)
    await Promise.all(sessions.slice(i, i + PARALLEL).map(read))
  return { rows, unreadable }
}
