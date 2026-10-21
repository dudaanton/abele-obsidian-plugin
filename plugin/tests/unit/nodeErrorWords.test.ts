import { afterEach, expect, it } from 'vitest'
import { nodeErrorWords, nodeActionError, nodeErrorDetails } from '@/node/errorWords'
import { presentUiError } from '@/i18n/streamBErrors'
import { initializeLocale } from '@/i18n'
import { catalogs } from '@/i18n/catalogs'

afterEach(() => initializeLocale('en'))

it.each(['Stage', 'Chat', 'Read'] as const)(
  'keeps the busy %s action explanation through notice rendering',
  (action) => {
    const failure = nodeActionError(new Error('resource_busy'), action)
    const words = presentUiError(failure)
    expect(nodeErrorDetails(words)).toBe(words)
    expect(words).toContain('resource_busy')
    expect(words).not.toContain('delet')
  }
)

it('explains a busy worktree separately from a rate limit', () => {
  expect(nodeErrorWords('resource_busy')).toContain('in use')
  expect(nodeErrorWords('resource_busy')).not.toContain('deleting')
  expect(nodeErrorWords('resource_busy')).not.toBe(nodeErrorWords('rate_limit'))
  expect(nodeErrorWords('resource_busy')).not.toContain('delet')
})

it.each([
  [
    'workspace_dirty',
    'The worktree has uncommitted changes. Commit or discard them before deleting it.',
  ],
  ['trace_run_not_found', 'This run is no longer on the node.'],
  [
    'paired_route_tls_or_unreachable',
    'The node could not be reached securely. Check its address, certificate and connection.',
  ],
  ['unauthorized', 'The node refused access. Pair again or check your permissions.'],
  [
    'outcome_unknown',
    'The result is unknown. Refresh and check what happened before trying again.',
  ],
  ['output_limit', 'The node returned too much output. Narrow the request or use paging.'],
  ['rate_limit', 'The node reached a limit. Wait before trying again.'],
  [
    'debugger_profile_unavailable',
    'The debugger is unavailable. Check the debug configuration and reconnect.',
  ],
  [
    'future_refusal',
    'The node could not complete the request. Check the details before trying again. (future_refusal)',
  ],
])('explains %s', (code, expected) => {
  expect(nodeErrorWords(code)).toBe(expected)
})
it('recognizes codes wrapped by receipt errors', () => {
  expect(nodeErrorWords('Not accepted: unauthorized')).toBe(nodeErrorWords('unauthorized'))
  expect(nodeErrorWords('UNAUTHORIZED')).toBe(nodeErrorWords('unauthorized'))
  expect(
    nodeErrorWords('The original removal was refused: unauthorized. Its receipt is retained.')
  ).toBe(nodeErrorWords('unauthorized'))
})
it('preserves existing plain explanations', () => {
  expect(nodeErrorWords('Your local draft is retained.')).toBe('Your local draft is retained.')
  expect(nodeErrorWords('Connection failed. Check the address.')).toBe(
    'Connection failed. Check the address.'
  )
  expect(nodeErrorWords('Connected')).toBe('Connected')
})

it('explains the node unreachable code as a connection failure', () => {
  expect(nodeErrorWords('node_unreachable')).toBe(nodeErrorWords('unreachable'))
})

it('distinguishes request size limits from temporary limits', () => {
  expect(nodeErrorWords('record_too_large')).toBe(
    'The request is too large. Reduce its size and try again.'
  )
})
it('does not describe a refused pairing address as an untrusted project', () => {
  expect(nodeErrorWords('paired_route_host_not_accepted')).toBe(
    'The node address was refused. Check the address allowed by the pairing invitation.'
  )
})
it('uses the generic fallback for unknown codes even when their names contain familiar words', () => {
  expect(nodeErrorWords('future_tls_failure')).toBe(
    'The node could not complete the request. Check the details before trying again. (future_tls_failure)'
  )
})

it.each(['en', 'ru', 'lv', 'es', 'de'] as const)(
  'uses the %s catalog for every explanation',
  (locale) => {
    initializeLocale(locale, catalogs[locale])
    for (const code of [
      'paired_route_tls_or_unreachable',
      'unauthorized',
      'outcome_unknown',
      'rate_limit',
      'output_limit',
      'debugger_profile_unavailable',
      'offline',
      'pairing_required',
      'identity_mismatch',
      'stale_revision',
      'trust_required',
      'unsupported_method',
      'future_refusal',
      'record_too_large',
      'paired_route_host_not_accepted',
    ]) {
      const result = nodeErrorWords(code)
      if (code === 'future_refusal') {
        expect(result).toBe(`${catalogs[locale]['node.error.generic']} (${code})`)
        continue
      }
      expect(result).not.toContain(code)
      expect(
        Object.entries(catalogs[locale]).some(
          ([key, value]) => key.startsWith('node.error.') && value === result
        )
      ).toBe(true)
    }
  }
)

it.each(['FUTURE_FAILURE', 'future-code', 'futurecode', 'Not accepted: Future_Failure.'])(
  'preserves the original spelling of an unknown code in %s',
  (raw) => {
    const code = raw === 'Not accepted: Future_Failure.' ? 'Future_Failure' : raw
    expect(nodeErrorWords(raw)).toBe(
      `The node could not complete the request. Check the details before trying again. (${code})`
    )
  }
)
