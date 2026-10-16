import { expect, it, vi } from 'vitest'
import { MemoryClientStore, type NodeClient } from '@abele/node-client'
import { NodePathClientPort } from '@/node/NodePathClientPort'
import { supportsExpectedTarget } from '@/node/expectedTarget'

it.each(['0.4.18', '0.4.19'])(
  'recognizes the discovery release field from node %s',
  (node_version) => {
    expect(supportsExpectedTarget({ node_version })).toBe(true)
  }
)
it('uses the discovery release before the legacy release field', () => {
  expect(supportsExpectedTarget({ node_version: '0.4.1', version: '0.4.19' })).toBe(false)
})

it.each(['0.4.2', '0.4.3', '0.5.0', '1.0.0', '0.4.2+sample'])(
  'supports guarded turns from node release %s',
  (version) => {
    expect(supportsExpectedTarget({ version })).toBe(true)
  }
)
it.each([undefined, null, '', 'unknown', '5', '0.4.1', '0.3.9', '0.4.2-preview', 'v0.4.2', 4])(
  'does not infer support from an absent, old or unknown node release (%j)',
  (version) => {
    expect(supportsExpectedTarget({ version })).toBe(false)
  }
)
it.each([true, false])(
  'carries a session incarnation into the displayed catalogue only for supported releases (supported: %s)',
  async (supported) => {
    const read = vi.fn(async () => ({
      project_id: 'sample-project',
      target: { kind: 'workspace' as const, workspace_id: 'sample-workspace' },
      ...(supported ? { incarnation: 'sample-binding' } : {}),
    }))
    const client = {
      describe: async () => ({
        version: supported ? '0.4.2' : '0.4.1',
        capabilities: {
          capabilities: { node_path_execution: { status: 'supported' } },
        },
      }),
      listProjects: async (after?: string) =>
        after ? [] : [{ project_id: 'sample-project', root_path: '/sample/folder' }],
      listSessions: async (after?: string) =>
        after ? [] : [{ session_id: 'sample-session', workspace_id: 'sample-workspace' }],
      listWorkspaces: async (_project: string, after?: string) =>
        after ? [] : [{ workspace_id: 'sample-workspace', kind: 'root' }],
      nodePath: { sessionWorktreeGet: read },
      subscribe: async () => {},
      store: new MemoryClientStore(),
    } as unknown as NodeClient
    const result = await new NodePathClientPort(client, {
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
    }).catalogue()
    expect(read).toHaveBeenCalledWith({
      session_id: 'sample-session',
      ...(supported ? { include_incarnation: true } : {}),
    })
    expect(result.sessions[0].target?.incarnation).toBe(supported ? 'sample-binding' : undefined)
  }
)
it('does not mistake a provider or protocol version for a node release', () => {
  expect(
    supportsExpectedTarget({
      capabilities: { provider_version: '5' },
      providers: [{ provider_version: '1.0.0' }],
    })
  ).toBe(false)
  expect(supportsExpectedTarget({ version: { major: 0, minor: 4 } })).toBe(false)
})
