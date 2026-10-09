import type { DelegationGrant } from '@abele/node-client'
import type { NodeDelegationController } from '@/node/NodeDelegationController'
import type { DelegationCard } from '@/node/delegation'
const grant: DelegationGrant = {
  grant_id: 'sample-grant',
  parent_id: 'sample-parent',
  installation_id: 'sample-installation',
  approved_by: 'sample-installation',
  project_ids: ['sample-project'],
  providers: ['pi'],
  actions: ['create', 'send', 'status', 'cancel', 'read'],
  allow_fake: false,
  revoked: false,
  created_at: '2028-01-01T00:00:00Z',
}
export function nodeDelegationGrantsFixture() {
  let current = { ...grant }
  const controller = {
    restore: async () => {},
    grants: async () => [current],
    approve: async () => {
      current = { ...grant }
      return current
    },
    revoke: async () => {
      current = { ...grant, revoked: true }
      return current
    },
    client: {
      listProjects: async (after?: string) =>
        after
          ? []
          : [
              {
                project_id: 'sample-project',
                root_path: '/workspace/sample-project-with-a-long-name',
                repository_path: '/workspace/sample-project-with-a-long-name',
                trust: 'trusted',
              },
            ],
      describe: async () => ({
        providers: [
          { provider: 'pi', available: true },
          { provider: 'claude', available: true },
          { provider: 'fake', available: true },
        ],
      }),
    },
  } as unknown as NodeDelegationController
  return {
    controller,
    label: 'Sample node',
    parents: [{ id: 'sample-parent', title: 'Sample parent chat with a longer title' }],
    initialParentId: 'sample-parent',
  }
}
export function nodeDelegationCardFixture(): DelegationCard {
  return {
    delegationId: 'sample-delegation',
    sessionId: 'sample-child',
    nodeId: 'sample-node',
    title: 'Review a sample parser and improve its boundary cases',
    provider: 'pi',
    state: 'completed',
    pendingHumanPrompts: 1,
    reports: [
      {
        seq: 1,
        kind: 'question',
        text: 'A human approval is required in the child chat; this report does not answer it.',
      },
      {
        seq: 2,
        kind: 'result',
        text: 'Implemented the sample parser change and verified the unit tests.\nThe full transcript and changed files remain available in the child chat.',
      },
    ],
  }
}
