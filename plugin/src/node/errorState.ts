import { t } from '@/i18n'
import { nodeErrorWords, nodeOperationTimedOut } from './errorWords'

export type NodeErrorAction =
  | 'retry'
  | 'refresh'
  | 'reconnect'
  | 'trust'
  | 'pair'
  | 'settings'
  | 'update'
  | 'install'
export interface NodeErrorState {
  tone: 'red' | 'orange' | 'faint'
  text: string
  pulse?: boolean
  action?: NodeErrorAction
}

/** Presentation policy only. Callers keep the original protocol evidence and own the action. */
export function nodeErrorState(
  error: string,
  context: {
    reconnecting?: boolean
    offline?: boolean
    slow?: boolean
    elapsed?: number
  } = {}
): NodeErrorState {
  if (context.reconnecting)
    return { tone: 'faint', text: t('node.state.reconnecting'), pulse: true, action: undefined }
  if (context.slow)
    return {
      tone: 'faint',
      text: t('node.state.slow'),
      pulse: true,
      action: (context.elapsed ?? 0) >= 30000 ? 'retry' : undefined,
    }
  const text = /^No answer from the node\./.test(error)
    ? t('node.error.unknownOutcome')
    : nodeErrorWords(error)
  const is = (code: string) => text === nodeErrorWords(code)
  if (is('device_identity_mismatch') || is('pairing_required'))
    return { tone: 'red', text, action: 'pair' }
  if (context.offline || is('offline'))
    return { tone: 'red', text: t('node.state.offline'), action: 'reconnect' }
  if (nodeOperationTimedOut(error)) return { tone: 'orange', text, action: 'retry' }
  if (is('outcome_unknown') || is('stale_revision') || is('stale_resource'))
    return { tone: 'orange', text, action: 'refresh' }
  if (is('project_untrusted')) return { tone: 'orange', text, action: 'trust' }
  if (is('unauthorized') || is('host_not_accepted') || is('tls'))
    return { tone: 'red', text, action: 'settings' }
  if (is('unsupported_method')) return { tone: 'orange', text, action: 'update' }
  if (is('provider_unavailable')) return { tone: 'orange', text, action: 'install' }
  if (
    is('resource_busy') ||
    [t('node.error.busyStage'), t('node.error.busyChat'), t('node.error.busyRead')].includes(text)
  )
    return { tone: 'faint', text, action: undefined }
  if (is('file_too_large') || is('output_limit') || is('rate_limit') || is('slow_consumer'))
    return { tone: 'orange', text, action: undefined }
  return { tone: 'red', text: text || t('node.error.generic'), action: 'retry' }
}

export function nodeErrorActionLabel(action?: NodeErrorAction): string | undefined {
  return action ? t(`node.action.${action}`) : undefined
}
