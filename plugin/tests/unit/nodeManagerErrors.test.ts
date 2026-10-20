import { expect, it } from 'vitest'
import { nodeErrorWords } from '@/node/errorWords'
it('preserves a node refusal code and message rather than guessing a limit from its prose', () => {
  const message =
    'resource_busy: request could not acquire the worktree; rate_limit is not configured'
  expect(nodeErrorWords(message)).toContain(message)
  expect(nodeErrorWords(message)).not.toContain('Node reached a limit')
})
it('does not describe stream backpressure as a node rate limit', () => {
  expect(nodeErrorWords('slow_consumer')).not.toContain('reached a limit')
})

it('keeps the exact refusal code visible beside its explanation', async () => {
  const { nodeErrorDetails } = await import('@/node/errorWords')
  expect(nodeErrorDetails('resource_busy')).toContain('resource_busy')
  expect(nodeErrorDetails('slow_consumer')).toContain('slow_consumer')
})
