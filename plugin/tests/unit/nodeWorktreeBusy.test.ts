import { expect, it } from 'vitest'
import { ChannelError } from '@abele/channel-protocol'
import { worktreeBusy } from '@/node/worktreeBusy'

it('identifies the sessions and other holders of the selected worktree only', () => {
  const target = { id: 'sample-worktree', projectId: 'sample-project' }
  const model = {
    sessions: {
      value: [
        { target, session: { session_id: 'sample-session', title: 'Sample chat' } },
        {
          target: { ...target, id: 'other-worktree' },
          session: { session_id: 'other-session', title: 'Other chat' },
        },
      ],
    },
  }
  expect(
    worktreeBusy(
      new ChannelError('resource_busy', 'Busy', { holders: [{ label: 'Language server' }] }),
      model as never,
      target as never
    )
  ).toEqual({
    sessions: [{ id: 'sample-session', title: 'Sample chat' }],
    labels: ['Sample chat', 'Language server'],
  })
  expect(
    worktreeBusy(new ChannelError('rate_limit'), model as never, target as never)
  ).toBeUndefined()
  expect(
    worktreeBusy(
      new ChannelError('resource_busy', 'resource_busy', {
        holder: 'execution',
        session_id: 'remote-session',
        title: 'Build chat',
      }),
      model as never,
      target as never
    )
  ).toEqual({
    sessions: [
      { id: 'sample-session', title: 'Sample chat' },
      { id: 'remote-session', title: 'Build chat' },
    ],
    labels: ['Sample chat', 'Build chat'],
  })
})
