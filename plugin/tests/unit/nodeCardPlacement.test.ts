import { expect, it } from 'vitest'
import { nodeCardPlacement } from '@/node/cardPlacement'
import { chatBlocks } from '@/ai/toolRuns'
import { nodeMutationKey } from '@/ai/tools/node/mutations'

it.each(['node', 'command', 'project_id'])(
  'does not recover another command when %s differs',
  (key) => {
    const request = { command: 'printf sample', project_id: 'sample-project' }
    const operation = nodeMutationKey('sample-parent', 'node_command_run', 'sample-alias', request)
    const params = {
      node: 'sample-node',
      operation_id: 'sample-alias',
      ...request,
      [key]: 'different-sample',
    }
    const calls = [
      { id: 'sample-call', role: 'tool-call', toolName: 'node_command_run', toolParams: params },
    ]
    const placement = nodeCardPlacement(chatBlocks(calls as never), calls as never, {
      parentId: 'sample-parent',
      operations: [{ nodeIds: ['sample-node'], operation, placementParams: request }],
    })
    expect(Object.values(placement).flat()).not.toContain(`operation:${operation}`)
  }
)
it('keeps older cards anchored when only the newest messages are visible after reload', () => {
  const history = [
    {
      id: 'old-call',
      role: 'tool-call',
      toolName: 'node_delegate',
      toolParams: { task_key: 'old-task' },
    },
    { id: 'latest', role: 'assistant', content: 'Finished' },
  ]
  const visible = chatBlocks(history.slice(-1) as never)
  const placements = nodeCardPlacement(visible, history as never)
  expect(Object.values(placements).flat()).toContain('task:old-task')
  expect(placements.latest).toBeUndefined()
})
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
