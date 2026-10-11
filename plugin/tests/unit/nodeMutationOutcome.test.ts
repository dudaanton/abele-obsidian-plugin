import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient } from '@abele/node-client'
import { ChannelError } from '@abele/channel-protocol'
import {
  ProjectSchema,
  WorkspaceSchema,
  FileContentSchema,
  ContentChunkSchema,
  FileMutationResultSchema,
  WorktreePageSchema,
  RepositoryObservationSchema,
  RepositoryBlobSchema,
  FileWriteSchema,
  RelativePathSchema,
} from '@abele/node-protocol'
import { bytesToHex } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha2'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeScopeLedger } from '@/ai/nodeScope'
import { createNodeAgentTools, type NodeAgentHost } from '@/ai/tools/node/agent'
import type { ChatSession } from '@/ai/ChatSession'

const hash = (text: string) => bytesToHex(sha256(new TextEncoder().encode(text)))
const args = {
  node: 'sample-node',
  project: 'sample-project',
  workspace: 'sample-folder',
  target_kind: 'workspace',
  path: 'sample.txt',
  expected_content_id: hash('old'),
  text: 'new',
}
async function setup() {
  const idb = new IDBFactory()
  let store = new NodeClientStore('sample-mutation', idb)
  await store.transaction((state) => {
    state.node_id = 'sample-node'
    state.installation_id = 'sample-installation'
  })
  let connected = true
  const ledger = new NodeScopeLedger()
  const session = {
    nodeScopeIdentity: 'sample-chat',
    overrides: {
      value: {
        nodeScope: [
          { kind: 'project', node_id: 'sample-node', project_id: 'sample-project', access: 'edit' },
        ],
      },
    },
    conversationVersion: { value: 0 },
    branchSelectionVersion: 0,
    permissionMode: { value: 'allow-edit' },
  } as unknown as ChatSession
  ledger.approve(session, { 'sample-node': 'sample-authority' })
  function buildClient() {
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:1/channel', profile: 'local-token-v1', token: 'sample-token' },
      store
    )
    vi.spyOn(client, 'connected', 'get').mockImplementation(() => connected)
    vi.spyOn(client, 'getProject').mockResolvedValue(
      ProjectSchema.parse({
        project_id: 'sample-project',
        root_path: '/sample',
        repository_path: null,
        git_common_dir: null,
        trust: 'untrusted',
        use_repository_claude_permissions: false,
        created_at: '2026-01-01T00:00:00Z',
      })
    )
    vi.spyOn(client, 'getWorkspace').mockResolvedValue(
      WorkspaceSchema.parse({
        workspace_id: 'sample-folder',
        project_id: 'sample-project',
        kind: 'root',
        path: '/sample',
        branch: null,
        base_commit: null,
        state: 'ready',
        provenance: {
          node_id: 'sample-node',
          installation_id: 'sample-installation',
          operation_id: 'sample-register',
        },
        created_at: '2026-01-01T00:00:00Z',
      })
    )
    vi.spyOn(client, 'readFile').mockResolvedValue(
      FileContentSchema.parse({
        workspace_id: 'sample-folder',
        path: 'sample.txt',
        content_id: hash('old'),
        size: 3,
        binary: false,
        large: false,
        too_large: false,
      })
    )
    vi.spyOn(client, 'readContent').mockResolvedValue(
      ContentChunkSchema.parse({ offset: 0, total: 3, base64: btoa('old') })
    )
    return client
  }
  let client = buildClient()
  const host: NodeAgentHost = {
    ledger,
    nodes: () => [],
    connection: () => ({ client, principal: () => 'sample-authority' }),
  }
  const factory = () => host
  const callTool = (
    name: string,
    id = 'sample-call',
    params: Record<string, unknown> = args,
    signal?: AbortSignal
  ) =>
    createNodeAgentTools(factory)
      .find((tool) => tool.name === name)!
      .execute(id, params, signal, { session, interactive: true })
  const call = (id = 'sample-call', params = args, signal?: AbortSignal) =>
    callTool('node_write', id, params, signal)
  return {
    ledger,
    session,
    call,
    callTool,
    client: () => client,
    connected: (value: boolean) => {
      connected = value
    },
    reopen: () => {
      store.close()
      store = new NodeClientStore('sample-mutation', idb)
      client = buildClient()
      return client
    },
    close: () => store.close(),
  }
}
describe('node mutation identity after admission', () => {
  for (const [tool, method] of [
    ['node_mv', 'fileMove'],
    ['node_cp', 'fileCopy'],
    ['node_rm', 'fileRemove'],
  ]) {
    it(`${tool} retains its operation through an uncertain typed file operation and retries under the same ID`, async () => {
      const fixture = await setup(),
        calls: string[] = []
      fixture.session.permissionMode.value = 'allow-all'
      const params = { ...args, from: 'sample.txt', to: 'copy.txt' }
      const configure = (client: NodeClient, uncertain: boolean) => {
        vi.spyOn(client, 'describe').mockResolvedValue({
          capabilities: {
            capabilities: {
              node_path_file_operations: {
                status: 'supported',
                evidence: 'sample contract fixture',
              },
            },
          },
        })
        // Contract-parsed fake effect; the registered file/hash primitives come from node-protocol.
        const input =
          method === 'fileRemove'
            ? FileWriteSchema.omit({ text: true })
            : FileWriteSchema.omit({ text: true, path: true })
                .extend({ from: FileWriteSchema.shape.path, to: FileWriteSchema.shape.path })
                .strict()
        const result = z
          .object({
            operation_id: z.string().min(1).max(128),
            state: z.enum(['applied', 'conflict', 'outcome_unknown']),
            recovery_path: z.string().nullable(),
          })
          .strict()
        Object.assign(client, {
          nodePath: {
            [method]: async (raw: unknown, operation: string) => {
              input.parse(raw)
              if (method !== 'fileRemove') RelativePathSchema.parse((raw as { to: string }).to)
              calls.push(operation)
              if (uncertain) {
                fixture.connected(false)
                throw new ChannelError('outcome_unknown')
              }
              return result.parse({
                operation_id: operation,
                state: 'applied',
                recovery_path: null,
              })
            },
          },
        })
      }
      try {
        configure(fixture.client(), true)
        const first = await fixture.callTool(tool, 'sample-first', params)
        const operation_id = (first.details as { operation_id: string }).operation_id
        expect(first.details).not.toHaveProperty('diff')
        const reopened = fixture.reopen()
        fixture.connected(true)
        configure(reopened, false)
        expect(
          (await fixture.callTool(tool, 'sample-retry', { ...params, operation_id })).details
        ).toMatchObject({ operation_id, state: 'applied' })
        expect(calls).toEqual([operation_id, operation_id])
        expect(reopened.readFile).not.toHaveBeenCalled()
      } finally {
        fixture.close()
      }
    })
  }

  it('reports the accepted operation after a disconnect and reuses it after store/tool reconstruction', async () => {
    const fixture = await setup()
    try {
      vi.spyOn(fixture.client(), 'flush').mockImplementation(async () => {
        fixture.connected(false)
        throw new ChannelError('disconnected')
      })
      const first = await fixture.call()
      const operation = (await fixture.client().pending())[0].operation_id
      expect(first.details).toMatchObject({ operation_id: operation })
      expect(first.content[0].text).toMatch(/pending|unknown/)
      expect(first.details).not.toHaveProperty('diff')
      const reopened = fixture.reopen()
      const offline = await fixture.call('sample-retry')
      expect(offline.details).toMatchObject({ operation_id: operation })
      expect(await reopened.pending()).toHaveLength(1)
      fixture.connected(true)
      vi.spyOn(reopened, 'flush').mockResolvedValue(undefined)
      const retry = await fixture.call('sample-online-retry')
      expect(retry.details).toMatchObject({ operation_id: operation })
      expect((await reopened.pending()).map((entry) => entry.operation_id)).toEqual([operation])
    } finally {
      fixture.close()
    }
  })
  it('retains Git write IDs through disconnect and does not re-read the file on retry', async () => {
    const fixture = await setup()
    const configure = async (client: NodeClient) => {
      vi.mocked(client.getProject).mockResolvedValue({
        ...(await client.getProject('sample-project')),
        repository_path: '/sample',
        git_common_dir: '/sample/.git',
      })
      vi.spyOn(client.repository, 'worktrees').mockResolvedValue(
        WorktreePageSchema.parse({
          entries: [
            {
              worktree_id: 'sample-tree',
              project_id: 'sample-project',
              workspace_id: 'sample-folder',
              kind: 'root',
              path_label: '/sample',
              branch: 'sample-branch',
              detached: false,
              head: '1'.repeat(40),
              availability: 'available',
              locked: false,
              prunable: false,
              dirty: true,
            },
          ],
          cursor: null,
          incomplete: false,
          omissions: [],
        })
      )
      vi.spyOn(client.repository, 'observe').mockResolvedValue(
        RepositoryObservationSchema.parse({
          revision: {
            kind: 'working',
            observation_id: 'sample-observation',
            head: '1'.repeat(40),
            observed_at: '2026-01-01T00:00:00Z',
          },
          atomic: false,
        })
      )
      vi.spyOn(client.repository, 'blob').mockResolvedValue(
        RepositoryBlobSchema.parse({
          content_id: hash('old'),
          size: 3,
          binary: false,
          requires_larger_load: false,
          too_large: false,
        })
      )
      vi.spyOn(client.repository, 'content').mockResolvedValue(
        ContentChunkSchema.parse({ offset: 0, total: 3, base64: btoa('old') })
      )
    }
    try {
      await configure(fixture.client())
      vi.spyOn(fixture.client(), 'flush').mockImplementation(async () => {
        fixture.connected(false)
        throw new ChannelError('disconnected')
      })
      const params = { ...args, target_kind: 'worktree', workspace: 'sample-tree' }
      const result = await fixture.call('sample-git-call', params)
      const operation_id = (result.details as { operation_id: string }).operation_id
      expect((await fixture.client().pending())[0]).toMatchObject({
        operation_id,
        method: 'repository.v1.write',
      })
      const reopened = fixture.reopen()
      fixture.connected(true)
      await configure(reopened)
      vi.spyOn(reopened, 'flush').mockResolvedValue(undefined)
      expect((await fixture.call('sample-git-retry', params)).details).toMatchObject({
        operation_id,
      })
      expect((await reopened.pending()).map((entry) => entry.operation_id)).toEqual([operation_id])
      expect(reopened.repository.blob).not.toHaveBeenCalled()
    } finally {
      fixture.close()
    }
  })
  it('rejects changed retry text/preconditions instead of binding them to the retained ID', async () => {
    const fixture = await setup()
    try {
      vi.spyOn(fixture.client(), 'flush').mockImplementation(async () => {
        fixture.connected(false)
        throw new ChannelError('disconnected')
      })
      const result = await fixture.call()
      const operation_id = (result.details as { operation_id: string }).operation_id
      fixture.connected(true)
      await expect(
        fixture.call('sample-changed-retry', {
          ...args,
          text: 'different',
          operation_id,
        } as typeof args)
      ).rejects.toThrow(/exact request/)
      await expect(
        fixture.call('sample-changed-precondition', {
          ...args,
          expected_content_id: hash('different'),
          operation_id,
        } as typeof args)
      ).rejects.toThrow(/exact request/)
      expect((await fixture.client().pending()).map((entry) => entry.operation_id)).toEqual([
        operation_id,
      ])
    } finally {
      fixture.close()
    }
  })
  it('preserves a known negative receipt as rejection rather than an uncertain success', async () => {
    const fixture = await setup()
    try {
      vi.spyOn(fixture.client(), 'flush').mockImplementation(async () => {
        await fixture.client().store.transaction((state) => {
          const entry = state.outbox[0]
          state.results[entry.operation_id] = {
            error: 'unauthorized',
            request: { method: entry.method, params: entry.params },
          }
          state.outbox = []
        })
      })
      const result = await fixture.call()
      expect(result.details).toMatchObject({ state: 'rejected', operation_id: expect.any(String) })
      expect(result.details).not.toHaveProperty('diff')
    } finally {
      fixture.close()
    }
  })
  it('keeps an admitted operation visible when cancellation or scope revocation happens while flushing', async () => {
    const fixture = await setup(),
      controller = new AbortController()
    try {
      vi.spyOn(fixture.client(), 'flush').mockImplementation(async () => {
        fixture.ledger.revoke(fixture.session)
        controller.abort()
      })
      const result = await fixture.call('sample-call', args, controller.signal)
      const operation = (await fixture.client().pending())[0].operation_id
      expect(result.details).toMatchObject({ operation_id: operation })
      expect(result.details).not.toHaveProperty('diff')
      expect(result.content[0].text).toMatch(/pending|unknown/)
    } finally {
      fixture.close()
    }
  })
  it('checks the same receipt on retry instead of re-reading an already changed file or creating another write', async () => {
    const fixture = await setup()
    try {
      vi.spyOn(fixture.client(), 'flush').mockImplementationOnce(async () => {
        fixture.connected(false)
        throw new ChannelError('disconnected')
      })
      const first = await fixture.call()
      const operation = (first.details as { operation_id: string }).operation_id
      const reopened = fixture.reopen()
      fixture.connected(true)
      vi.mocked(reopened.readFile).mockResolvedValue(
        FileContentSchema.parse({
          workspace_id: 'sample-folder',
          path: 'sample.txt',
          content_id: hash('new'),
          size: 3,
          binary: false,
          large: false,
          too_large: false,
        })
      )
      vi.spyOn(reopened, 'flush').mockImplementation(async () => {
        await reopened.store.transaction((state) => {
          expect(state.outbox.map((entry) => entry.operation_id)).toEqual([operation])
          state.results[operation] = {
            request: { method: 'workspace.write', params: state.outbox[0].params },
            result: FileMutationResultSchema.parse({
              operation_id: operation,
              workspace_id: 'sample-folder',
              path: 'sample.txt',
              state: 'saved',
              expected_content_id: hash('old'),
              predecessor_content_id: hash('old'),
              content_id: hash('new'),
              recovery_path: null,
            }),
          }
          state.outbox = []
        })
      })
      const result = await fixture.call('sample-retry')
      expect(result.details).toMatchObject({
        operation_id: operation,
        state: 'saved',
        diff: { old: 'old', new: 'new' },
      })
      expect(reopened.readFile).not.toHaveBeenCalled()
    } finally {
      fixture.close()
    }
  })
})
