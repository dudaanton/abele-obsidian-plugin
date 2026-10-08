import { PromptSchema } from '@abele/node-protocol'
import type { ClientState } from '@abele/node-client'
import type { NodeClientState } from './NodeClientStore'

export interface PromptAnswerState {
  choice: 'allow' | 'deny'
  state: 'pending' | 'answered' | 'rejected'
  error?: string
  value?: string
}

/** Installation-local durable answer identity, independent of any mounted card. */
export function promptAnswerStates(
  state: Pick<NodeClientState, 'outbox' | 'results'>,
  sessionId: string
): Record<string, PromptAnswerState> {
  const answers: Record<string, PromptAnswerState> = {}
  for (const receipt of Object.values(state.results)) {
    const legacy = PromptSchema.safeParse(receipt.result)
    const identity =
      receipt.answer ??
      (legacy.success && legacy.data.state === 'resolved' && legacy.data.choice
        ? {
            sessionId: legacy.data.session_id,
            promptId: legacy.data.prompt_id,
            choice: legacy.data.choice,
            ...(typeof legacy.data.value === 'string' ? { value: legacy.data.value } : {}),
          }
        : undefined)
    if (identity?.sessionId === sessionId)
      answers[identity.promptId] = {
        choice: identity.choice,
        ...(identity.value !== undefined ? { value: identity.value } : {}),
        state: receipt.error ? 'rejected' : 'answered',
        ...(receipt.error ? { error: receipt.error } : {}),
      }
  }
  for (const entry of state.outbox) {
    if (entry.method !== 'prompt.answer') continue
    const p = entry.params as Record<string, unknown>
    if (
      p.session_id === sessionId &&
      typeof p.prompt_id === 'string' &&
      (p.choice === 'allow' || p.choice === 'deny')
    )
      answers[p.prompt_id] = {
        choice: p.choice,
        state: 'pending',
        ...(typeof p.value === 'string' ? { value: p.value } : {}),
      }
  }
  return answers
}

export function retainPromptAnswerIdentity(
  state: NodeClientState,
  submitted: ClientState['outbox']
): void {
  for (const entry of submitted) {
    if (entry.method !== 'prompt.answer') continue
    const receipt = state.results[entry.operation_id]
    if (!receipt) continue
    const p = entry.params as {
      session_id: string
      prompt_id: string
      choice: 'allow' | 'deny'
      value?: string
    }
    receipt.answer = {
      sessionId: p.session_id,
      promptId: p.prompt_id,
      choice: p.choice,
      ...(typeof p.value === 'string' ? { value: p.value } : {}),
    }
  }
}
