import { expect, it } from 'vitest'
import { nodeErrorState } from '@/node/errorState'

it.each([
  ['git_timeout', 'orange', 'retry'],
  ['timed_out', 'orange', 'retry'],
  ['outcome_unknown', 'orange', 'refresh'],
  ['project_untrusted', 'orange', 'trust'],
  ['unauthorized', 'red', 'settings'],
  ['device_identity_mismatch', 'red', 'pair'],
  ['unsupported_method', 'orange', 'update'],
  ['provider_unavailable', 'orange', 'install'],
  ['resource_busy', 'faint', undefined],
  ['file_too_large', 'orange', undefined],
  ['new_failure', 'red', 'retry'],
  ['offline', 'red', 'reconnect'],
])('gives %s its single safe action', (error, tone, action) => {
  expect(nodeErrorState(error)).toMatchObject({ tone, action })
  if (error.includes('_')) expect(nodeErrorState(error).text).not.toContain(error)
  else if (error === 'offline') expect(nodeErrorState(error).text).toBe('The node is offline.')
  else expect(nodeErrorState(error).text).not.toContain(error)
})

it('distinguishes slow, reconnecting and exhausted connections', () => {
  expect(nodeErrorState('', { reconnecting: true })).toMatchObject({
    tone: 'faint',
    pulse: true,
    action: undefined,
  })
  expect(nodeErrorState('', { slow: true, elapsed: 29999 })).toMatchObject({
    tone: 'faint',
    action: undefined,
  })
  expect(nodeErrorState('', { slow: true, elapsed: 30000 })).toMatchObject({ action: 'retry' })
})
