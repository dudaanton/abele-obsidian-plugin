import { afterEach, expect, it } from 'vitest'
import { nodeErrorWords } from '@/node/errorWords'
import { initializeLocale } from '@/i18n'
import { catalogs } from '@/i18n/catalogs'

afterEach(() => initializeLocale('en'))

it.each([
  [
    'paired_route_tls_or_unreachable',
    'The node could not be reached securely. Check its address, certificate and connection.',
  ],
  ['unauthorized', 'The node refused access. Pair again or check your permissions.'],
  [
    'outcome_unknown',
    'The result is unknown. Refresh and check what happened before trying again.',
  ],
  ['rate_limit', 'The node reached a limit. Wait before trying again.'],
  [
    'debugger_profile_unavailable',
    'The debugger is unavailable. Check the debug configuration and reconnect.',
  ],
  [
    'future_refusal',
    'The node could not complete the request. Check the details before trying again.',
  ],
])('explains %s without showing the code', (code, expected) => {
  expect(nodeErrorWords(code)).toBe(expected)
})
it('recognizes codes wrapped by receipt errors', () => {
  expect(nodeErrorWords('Not accepted: unauthorized')).toBe(nodeErrorWords('unauthorized'))
  expect(nodeErrorWords('UNAUTHORIZED')).toBe(nodeErrorWords('unauthorized'))
})
it('preserves existing plain explanations', () => {
  expect(nodeErrorWords('Your local draft is retained.')).toBe('Your local draft is retained.')
  expect(nodeErrorWords('Connection failed. Check the address.')).toBe(
    'Connection failed. Check the address.'
  )
  expect(nodeErrorWords('Connected')).toBe('Connected')
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
  expect(nodeErrorWords('future_tls_failure')).toBe(nodeErrorWords('future_refusal'))
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
      expect(result).not.toContain(code)
      expect(
        Object.entries(catalogs[locale]).some(
          ([key, value]) => key.startsWith('node.error.') && value === result
        )
      ).toBe(true)
    }
  }
)
