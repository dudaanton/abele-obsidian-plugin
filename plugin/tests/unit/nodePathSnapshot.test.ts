import { describe, expect, it } from 'vitest'
import { NodePathSnapshotSchema } from '@/node/nodePathSnapshot'

describe('device-local node drawer snapshots', () => {
  it('accepts bounded display metadata but rejects credentials and another node identity', () => {
    const snapshot = {
      version: 1,
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      receivedAt: '2025-01-01T00:00:00.000Z',
      selected: 'sample-tree',
      folders: [
        {
          id: 'sample-project',
          name: 'Sample',
          path: '/sample/repo',
          git: true,
          copies: [
            {
              id: 'sample-tree',
              kind: 'project',
              branch: 'trunk',
              path: '/sample/repo',
              changed: 1,
              unseen: 1,
            },
          ],
        },
      ],
      targets: [
        {
          nodeId: 'sample-node',
          registrationId: 'sample-registration',
          projectId: 'sample-project',
          kind: 'worktree',
          id: 'sample-tree',
        },
      ],
      inspection: {
        entries: [{ path: 'sample.ts', name: 'sample.ts', kind: 'file' }],
        changes: [
          {
            path: 'sample.ts',
            kind: 'modified',
            stage: 'unstaged',
            changeId: 'change-demo',
            before: '',
            after: '',
            added: 0,
            removed: 0,
          },
        ],
      },
    }
    expect(NodePathSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(
      NodePathSnapshotSchema.safeParse({ ...snapshot, token: 'not a cache field' }).success
    ).toBe(false)
    expect(
      NodePathSnapshotSchema.safeParse({
        ...snapshot,
        targets: [{ ...snapshot.targets[0], nodeId: 'other-node' }],
      }).success
    ).toBe(false)
  })
})
