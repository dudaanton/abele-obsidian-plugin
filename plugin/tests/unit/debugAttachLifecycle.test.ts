import { expect, it, vi } from 'vitest'
import { cleanupDebugAttachViews, nodeFailureMessage } from '../e2e/helpers/debugAttachLifecycle'

it('puts the assertion before node diagnostics', () => {
  const text = nodeFailureMessage(
    new Error('Expected a detached session'),
    'running',
    'sample stderr'
  )
  expect(text.split('\n')[0]).toBe('Expected a detached session')
  expect(text).toContain('node: running\nsample stderr')
})

it('stops trace observers before closing their tabs and saves the active layout', async () => {
  const events: string[] = []
  const destroy = vi.fn(() => {
    events.push('destroy')
  })
  const getLeavesOfType = vi.fn((type: string) => [
    {
      detach: () => {
        events.push(type)
      },
    },
  ])
  await cleanupDebugAttachViews(
    { DebuggerService: { instance: { destroy } } },
    {
      getLeavesOfType,
      requestSaveLayout: {
        run: async () => {
          events.push('save')
        },
      },
    }
  )
  expect(events[0]).toBe('destroy')
  expect(events).toContain('abele-trace-run')
  expect(events.at(-1)).toBe('save')
})
