import type { ModelConfig } from './client/types'

export type ReasoningEffort = 'low' | 'medium' | 'high'

/** Keep a chat's preference while sending only what its current model supports. */
export function resolveChatEffort(
  model: Pick<ModelConfig, 'supportsReasoning' | 'reasoningEffort'>,
  override: ReasoningEffort | undefined
): ReasoningEffort | undefined {
  return model.supportsReasoning ? (override ?? model.reasoningEffort) : undefined
}
