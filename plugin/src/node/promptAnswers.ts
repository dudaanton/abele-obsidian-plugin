import { responseSchema } from '@abele/channel-protocol'
import { FrameCodec } from '@abele/channel-protocol'
import { PromptSchema, validateParams } from '@abele/node-protocol'
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
    const legacy = responseSchema(PromptSchema).safeParse(receipt.result)
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

/** Owner UI only. Both parent and child cards share the same durable answer identity. */
export async function answerOwnerPrompt(
  client: import('@abele/node-client').NodeClient,
  nodeId: string | undefined,
  raw: import('@abele/node-client').Prompt,
  choice: 'allow' | 'deny',
  value?: string
): Promise<void> {
  const prompt = responseSchema(PromptSchema).parse(raw)
  if (!client.connected) throw new Error('disconnected')
  if (prompt.state !== 'pending') return
  const { session_id, prompt_id, run_id, revision, action_digest } = prompt
  const params = validateParams('prompt.answer', {
    session_id,
    prompt_id,
    run_id,
    revision,
    action_digest,
    choice,
    ...(choice === 'allow' && value !== undefined ? { value } : {}),
  })
  const operation = crypto.randomUUID()
  FrameCodec.encode({
    kind: 'request',
    request_id: 'validation',
    operation_id: operation,
    method: 'prompt.answer',
    params,
  })
  const queued = await client.store.transaction((rawState) => {
    const state = rawState as NodeClientState
    // Token registrations learn identity at authenticated admission; paired ones pin it.
    const expected = nodeId ?? client.target.expected_node_id ?? state.node_id
    if (!expected || state.node_id !== expected) throw new Error('node_identity_mismatch')
    if (promptAnswerStates(state, session_id)[prompt_id]) return false
    state.outbox.push({ operation_id: operation, method: 'prompt.answer', params })
    return true
  })
  if (queued) {
    await client.flush()
    const receipt = await client.operationResult(operation)
    if (!receipt) throw new Error('outcome_unknown')
    if (receipt.error) throw new Error(receipt.error)
  }
}

/** Owner Stop for a manager effect: these are not provider runs. */
export async function cancelOwnerManagerRun(
  client: import('@abele/node-client').NodeClient,
  prompt: import('@abele/node-client').Prompt
): Promise<void> {
  if (!client.connected) throw new Error('disconnected')
  const params = validateParams('command.v1.cancel', {
    session_id: prompt.session_id,
    run_id: prompt.run_id,
  })
  const operation = crypto.randomUUID()
  await client.store.transaction((state) => {
    state.outbox.push({ operation_id: operation, method: 'command.v1.cancel', params })
  })
  await client.flush()
  const receipt = await client.operationResult(operation)
  if (receipt?.error) throw new Error(receipt.error)
}

/** Pending prompts can outlive the bounded transcript window. This is an owner read. */
export async function pendingOwnerPrompts(
  client: import('@abele/node-client').NodeClient,
  session: string
) {
  const prompts = new Map<string, import('@abele/node-client').Prompt>()
  let after: string | undefined
  for (let page = 0; page < 64; page++) {
    const rows = await client.prompts(session, after, 'pending')
    if (!rows.length) break
    for (const prompt of rows) prompts.set(prompt.prompt_id, prompt)
    const last = rows.at(-1)
    if (!last) break
    const next = last.prompt_id
    if (next === after) break
    after = next
  }
  return [...prompts.values()]
}
