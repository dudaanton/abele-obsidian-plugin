import { t } from '@/i18n'
import type { MessageKey } from '@/i18n/types'

type NodeErrorKey = Extract<MessageKey, `node.error.${string}`>

// Exact protocol/client codes: new codes get the generic explanation until classified.
const groups: readonly [NodeErrorKey, readonly string[]][] = [
  ['node.error.runMissing', ['trace_run_not_found']],
  ['node.error.staleResource', ['stale_resource']],
  ['node.error.folderUnavailable', ['repository_unavailable']],
  ['node.error.unknownOutcome', ['outcome_unknown', 'delivery_unknown', 'idempotency_mismatch']],
  [
    'node.error.tls',
    ['tls', 'tls_or_unreachable', 'paired_route_tls', 'paired_route_tls_or_unreachable'],
  ],
  [
    'node.error.access',
    [
      'unauthorized',
      'forbidden',
      'auth_failed',
      'approval_denied',
      'permission_denied',
      'access_denied',
      'file_not_writable',
    ],
  ],
  [
    'node.error.identity',
    [
      'device_identity_mismatch',
      'node_identity_mismatch',
      'installation_identity_mismatch',
      'identity_mismatch',
      'target_replaced',
      'target_changed',
      'different_node',
      'paired_route_different_node',
      'enrollment_changed',
    ],
  ],
  [
    'node.error.route',
    [
      'host_not_accepted',
      'policy_not_accepted',
      'endpoint_refused',
      'paired_route_host_not_accepted',
      'paired_route_policy_not_accepted',
    ],
  ],
  ['node.error.size', ['auth_too_large', 'record_too_large', 'file_too_large']],
  [
    'node.error.pairing',
    [
      'pairing_required',
      'pairing_failed',
      'pairing_cancelled',
      'pairing_upgrade_required',
      'pairing_wait_timeout',
      'pairing_client_changed',
      'invalid_pair_code',
      'invalid_pairing_configuration',
      'paired_profile_required',
    ],
  ],
  ['node.error.outputLimit', ['output_limit']],
  ['node.error.backpressure', ['slow_consumer']],
  ['node.error.busy', ['resource_busy']],
  ['node.error.limit', ['rate_limit', 'rate_limited', 'quota_exceeded']],
  [
    'node.error.debugger',
    [
      'debugger_profile_unavailable',
      'debugger_program_not_found',
      'debugger_online_only',
      'build_identity_unverified',
    ],
  ],
  [
    'node.error.connection',
    [
      'offline',
      'disconnected',
      'unreachable',
      'node_unreachable',
      'remote_unreachable',
      'paired_route_unreachable',
      'connect_before_queueing',
      'connect_failed',
      'connection_closed',
      'connection_failed',
      'connection_lost',
      'connection_timeout',
      'local_control_failed',
      'local_control_timeout',
      'timed_out',
      'git_timeout',
      'enotfound',
      'econnrefused',
      'econnreset',
    ],
  ],
  [
    'node.error.stale',
    [
      'stale_revision',
      'fresh_snapshot_required',
      'resync_required',
      'conflict',
      'prompt_expired',
      'recovery_expired',
      'invalid_anchor',
    ],
  ],
  ['node.error.trust', ['project_untrusted', 'untrusted', 'trust_required']],
  [
    'node.error.unavailable',
    [
      'unsupported_method',
      'unsupported_file_metadata',
      'unsupported_name',
      'profile_refused',
      'invalid_local_runtime',
      'unprotected_local_runtime',
      'native_runtime_unavailable',
      'storage_unavailable',
      'provider_unavailable',
    ],
  ],
]
const explanations = new Map(
  groups.flatMap(([key, codes]) => codes.map((code) => [code, key] as const))
)

/** Keep protocol diagnostics unchanged in state; translate only their presentation. */
export function nodeErrorWords(error: string | null | undefined): string {
  if (!error) return ''
  const raw = error.trim().toLowerCase()
  const diagnostic = error.trim().match(/^([a-z][a-z0-9_]+):\s*(\S[\s\S]*)$/)
  if (diagnostic) {
    const key = explanations.get(diagnostic[1])
    return `${t(key ?? 'node.error.generic')} (${error.trim()})`
  }
  const tokens = raw.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)
  const wrapped = raw.match(/[:·]\s*([a-z][a-z0-9_-]*)(?=$|[.!;,)\s])/)?.[1]
  const code =
    tokens?.[0] ??
    (wrapped && explanations.has(wrapped) ? wrapped : undefined) ??
    error.trim().match(/(?:^|:\s*)([a-z][a-z0-9_-]*)[.!]?$/)?.[1] ??
    (/^[A-Z][A-Z0-9_]+$/.test(error.trim()) ? raw : undefined)
  // Existing prose, including provider explanations, remains useful as written.
  if (!code) return error
  const key = code
    .split(' ')
    .map((value) => explanations.get(value))
    .find(Boolean)
  if (key) return t(key)
  const originalCode = code
    .split(' ')
    .map((value) => {
      const start = raw.indexOf(value)
      return error.trim().slice(start, start + value.length)
    })
    .join(' ')
  return `${t('node.error.generic')} (${originalCode})`
}

/** Keep protocol evidence visible on touch devices, where a title tooltip is unavailable. */
export function nodeErrorDetails(error: string | null | undefined): string {
  const words = nodeErrorWords(error)
  const raw = error?.trim()
  return raw && !words.includes(raw) ? `${words} (${raw})` : words
}
