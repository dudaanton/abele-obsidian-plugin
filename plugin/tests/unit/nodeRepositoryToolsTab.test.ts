import { describe, expect, it, vi } from 'vitest'
import { createNodeTools, NodeRepositoryToolsHost } from '@/ai/tools/node'
import { attachNodeRepositoryToolsTab } from '@/node/repositoryToolsTab'
import { NodeRepositorySource } from '@/repository/node'
import { nodeRepositoryFixture, identity, HEAD, BASE } from '../helpers/nodeRepositoryFixture'
import type { ChatSession } from '@/ai/ChatSession'
import type { ToolContext } from '@/ai/toolContext'

describe('real repository tab tool bridge', () => {
  it('registers the real source without granting a chat and maps node_open to the shared opener', async () => {
    const f = nodeRepositoryFixture(),
      source = new NodeRepositorySource(f.client, identity, {
        node: 'Sample node',
        project: 'Sample project',
      })
    const host = new NodeRepositoryToolsHost(),
      open = vi.fn(async () => ({}))
    const session = {} as ChatSession
    const target = {
      source: identity,
      location: { kind: 'file' as const, ref: HEAD, path: 'app.ts' },
    }
    const connection = { client: f.client, authorizationGeneration: 0 }
    const stop = attachNodeRepositoryToolsTab(
      source,
      connection,
      { target: () => target, selection: () => ({ code: 'selected sample' }) },
      host,
      open as any
    )
    const call = (name: string, params: Record<string, unknown> = {}) =>
      createNodeTools(host)
        .find((tool) => tool.name === name)!
        .execute(
          'sample-call',
          {
            node: identity.node,
            project: identity.project,
            workspace: identity.workspace,
            ...params,
          },
          undefined,
          { session } as ToolContext
        )
    expect((await call('node_views')).content[0].text).not.toContain('selected sample')
    await expect(call('node_file', { path: 'app.ts' })).rejects.toThrow(/grant/i)
    host.grant(session, identity.node, identity.project)
    expect((await call('node_file', { path: 'app.ts' })).content[0].text).toContain('42')
    expect((await call('node_views')).content[0].text).toContain('selected sample')
    await call('node_open', { path: 'app.ts', revision: HEAD, start_line: 2, end_line: 4 })
    expect(open).toHaveBeenLastCalledWith(identity.node, identity.project, identity.workspace, {
      path: 'app.ts',
      revision: HEAD,
      lines: { from: 2, to: 4 },
    })
    await call('node_open', { commit: HEAD })
    expect(open).toHaveBeenLastCalledWith(identity.node, identity.project, identity.workspace, {
      location: { kind: 'commit', commit: HEAD },
    })
    await call('node_open', { base: BASE })
    expect(open).toHaveBeenLastCalledWith(identity.node, identity.project, identity.workspace, {
      location: { kind: 'comparison', base: BASE, head: 'Working tree', direct: true },
    })
    stop()
    expect(host.tabs.size).toBe(0)
    await expect(call('node_file', { path: 'app.ts' })).rejects.toThrow(/source/i)
    source.dispose()
  })
  it('pins project grants to the connection authority and rejects cached selections offline or after reauthorization', async () => {
    const f = nodeRepositoryFixture(),
      source = new NodeRepositorySource(f.client, identity, { node: 'Sample', project: 'Sample' })
    const host = new NodeRepositoryToolsHost(),
      session = {} as ChatSession
    let connected = true
    const connection = {
      client: {
        get connected() {
          return connected
        },
      },
      authorizationGeneration: 0,
    }
    const stop = attachNodeRepositoryToolsTab(
      source,
      connection,
      {
        target: () => ({ source: identity, location: { kind: 'home' } }),
        selection: () => 'sample private selection',
      },
      host,
      vi.fn() as any
    )
    const tab = [...host.tabs][0]
    host.grant(session, identity.node, identity.project)
    const check = host.guard(session, tab)
    connected = false
    expect(check).toThrow(/offline/i)
    connected = true
    connection.authorizationGeneration++
    expect(check).toThrow(/grant|authority/i)
    stop()
    source.dispose()
  })
})
