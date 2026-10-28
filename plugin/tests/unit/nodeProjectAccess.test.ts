import { expect, it } from 'vitest'
import { NodeScopeLedger } from '@/ai/nodeScope'
import { nodeProjectGuard } from '@/ai/tools/node/projectAccess'
it('checks project tool levels and fences the connection and scope', async () => {
  const session = {
    nodeScopeIdentity: 'sample-chat',
    conversationVersion: { value: 0 },
    overrides: {
      value: {
        nodeScope: [
          { kind: 'project', node_id: 'sample-node', project_id: 'sample-project', access: 'read' },
        ],
      },
    },
  }
  let principal = 'sample-principal'
  const host = {
    ledger: new NodeScopeLedger(),
    nodeId: () => 'sample-node',
    connection: () => ({
      client: { connected: true },
      principal: () => principal,
      authorizationGeneration: 0,
    }),
  }
  const place = { registrationId: 'sample-registration', projectId: 'sample-project' }
  await expect(
    nodeProjectGuard(session as never, 'http_send', place, async () => host as never)
  ).rejects.toThrow()
  const guard = await nodeProjectGuard(
    session as never,
    'http_request_read',
    place,
    async () => host as never
  )
  guard()
  principal = 'replacement'
  expect(guard).toThrow()
})

it.each(['read', 'edit', 'run'] as const)(
  'authorizes project tools at %s only inside the exact folder',
  async (access) => {
    const session = {
      nodeScopeIdentity: 'sample-chat',
      conversationVersion: { value: 0 },
      permissionMode: { value: 'allow-all' },
      overrides: {
        value: {
          nodeScope: [
            {
              kind: 'target',
              node_id: 'sample-node',
              project_id: 'sample-project',
              target: { kind: 'worktree', worktree_id: 'sample-tree' },
              access,
            },
          ],
        },
      },
    }
    const host = {
      ledger: new NodeScopeLedger(),
      nodeId: () => 'sample-node',
      connection: () => ({
        client: { connected: true },
        principal: () => 'sample-principal',
        authorizationGeneration: 0,
      }),
    }
    for (const [name, allowed] of [
      ['http_request_read', true],
      ['http_request_save', access !== 'read'],
      ['trace_point_add', access !== 'read'],
      ['trace_point_remove', access !== 'read'],
      ['http_send', access === 'run'],
    ] as const) {
      const inside = nodeProjectGuard(
        session as never,
        name,
        {
          registrationId: 'sample-registration',
          projectId: 'sample-project',
          worktreeId: 'sample-tree',
        },
        async () => host as never
      )
      if (allowed) (await inside)()
      else await expect(inside).rejects.toThrow()
      await expect(
        nodeProjectGuard(
          session as never,
          name,
          {
            registrationId: 'sample-registration',
            projectId: 'sample-project',
            worktreeId: 'other-tree',
          },
          async () => host as never
        )
      ).rejects.toThrow()
    }
  }
)
