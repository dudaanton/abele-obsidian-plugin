import { expect, it } from 'vitest'
import { validateParams, sessionUpdatesOf } from '@abele/node-protocol'

it('carries the checkpoint restore contract without implying file consent', () => {
  expect(
    validateParams('session.configure', {
      session_id: 'sample-session',
      settings: { model: 'sample:provider/model' },
    })
  ).toMatchObject({ settings: { model: 'sample:provider/model' } })
  expect(
    validateParams('chat.restore', {
      session_id: 'sample-session',
      checkpoint_id: 'sample-point',
      action: 'retry',
    })
  ).toEqual({
    session_id: 'sample-session',
    checkpoint_id: 'sample-point',
    action: 'retry',
  })
})

it('maps legacy accepted inputs to canonical user updates and ignores mapped duplicates', () => {
  const event = {
    type: 'input.accepted',
    actor: { kind: 'node' as const },
    data: { input_id: 'sample-input', text: 'Sample revision' },
  }
  expect(sessionUpdatesOf(event)).toEqual([
    { kind: 'user_message', message_id: 'sample-input', text: 'Sample revision' },
  ])
  expect(sessionUpdatesOf({ ...event, data: { ...event.data, mapped: true } })).toEqual([])
})
