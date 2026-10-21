import { expect, it } from 'vitest'
import { nodeCardPlacement } from '@/node/cardPlacement'
it('anchors retained tasks and commands at their first visible call, deduplicating retries', () => {
  const call = { toolName: 'node_delegate', toolParams: { task_key: 'sample-task' } }
  expect(
    nodeCardPlacement([
      { kind: 'run', id: 'first', calls: [call] },
      {
        kind: 'run',
        id: 'retry',
        calls: [
          call,
          { toolName: 'node_command_run', toolParams: { operation_id: 'sample-operation' } },
        ],
      },
    ] as never)
  ).toEqual({ first: ['task:sample-task'], retry: ['operation:sample-operation'] })
})
