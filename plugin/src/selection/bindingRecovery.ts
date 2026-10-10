import type { BindingStatus } from './bindings'

/** Only atomic operation evidence can settle uncertainty. Identical text proves nothing. */
export function bindingRecoveryAction(status: BindingStatus, hasOperationEvidence: boolean) {
  if (hasOperationEvidence) return 'applied' as const
  if (status === 'uncertain') return 'review' as const
  if (status === 'pending' || status === 'known-not-written') return 'retry' as const
  return status
}
