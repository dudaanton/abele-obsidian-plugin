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
import { NodeRegistry, type PairedNode } from '@/node/NodeRegistry'
import { nodeAgentHost, setObsidianChatNodeScope } from '@/ai/tools/node/owner'

const owner = vi.hoisted(() => ({ service: null as unknown, app: null as unknown }))
vi.mock('@/node/NodeService', () => ({ NodeService: { getInstance: () => owner.service } }))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: owner.app }) },
}))
const registration: PairedNode = {
  id: 'sample-registration',
  label: 'Sample node',
  expectedNodeId: 'sample-node',
  url: 'wss://sample-node.sample.ts.net/channel',
  profile: 'paired-wss-v1',
  installationId: 'sample-installation',
  nodeFingerprint: 'a'.repeat(64),
  publicKey: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) },
}

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
async function setup(useOwner = false) {
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
    saveForRelease: vi.fn(async () => {}),
    ensureDelegationParentId: vi.fn(async () => {}),
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
  let host: NodeAgentHost = {
    ledger,
    nodes: () => [],
    connection: () => ({ client, authorizationGeneration: 0, principal: () => 'sample-authority' }),
  }
  let savedRegistry: unknown = [],
    generation = 0
  const registryStorage = {
    read: () => savedRegistry,
    write: (value: unknown) => {
      savedRegistry = value
    },
    getSecret: () => '',
    setSecret: vi.fn(),
    removeSecret: vi.fn(),
  }
  let registry = new NodeRegistry(registryStorage)
  const local = new Map<string, unknown>()
  const app = {
    loadLocalStorage: (key: string) => local.get(key),
    saveLocalStorage: (key: string, value: unknown) => {
      local.set(key, value)
    },
  }
  const buildService = () => ({
    registry,
    nodes: { value: registry.list() },
    connection: () => ({
      client,
      get authorizationGeneration() {
        return generation
      },
    }),
  })
  if (useOwner) {
    registry.addPaired(registration)
    owner.app = app
    owner.service = buildService()
    host = await nodeAgentHost()
    await setObsidianChatNodeScope(session, session.overrides.value.nodeScope!)
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
    host: () => host,
    rePair: async () => {
      registry.addPaired(registration)
      generation++
      await setObsidianChatNodeScope(session, session.overrides.value.nodeScope!)
    },
    advanceGeneration: () => {
      generation++
    },
    restart: async () => {
      store.close()
      store = new NodeClientStore('sample-mutation', idb)
      client = buildClient()
      generation = 0
      registry = new NodeRegistry(registryStorage)
      owner.service = buildService()
      host = await nodeAgentHost()
      return client
    },
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
  it.each(['invented-create', '__proto__', 'constructor', null, 42])(
    'saves a create with an unissued retry ID %s and publishes its diff',
    async (operationId) => {
      const fixture = await setup()
      try {
        vi.spyOn(fixture.client(), 'flush').mockImplementation(async () => {
          await fixture.client().store.transaction((state) => {
            const entry = state.outbox[0]
            expect(entry.operation_id).not.toBe(operationId)
            expect(entry.params).toMatchObject({ text: 'new', expected_content_id: null })
            state.results[entry.operation_id] = {
              request: { method: entry.method, params: entry.params },
              result: FileMutationResultSchema.parse({
                operation_id: entry.operation_id,
                workspace_id: 'sample-folder',
                path: 'sample.txt',
                state: 'saved',
                expected_content_id: null,
                predecessor_content_id: null,
                content_id: hash('new'),
                recovery_path: null,
              }),
            }
            state.outbox = []
          })
        })
        const result = await fixture.callTool('node_write', 'sample-create', {
          ...args,
          expected_content_id: null,
          operation_id: operationId,
        })
        expect(result.details).toMatchObject({ state: 'saved', diff: { old: '', new: 'new' } })
        expect(await fixture.client().pending()).toEqual([])
        expect(fixture.client().readFile).not.toHaveBeenCalled()
      } finally {
        fixture.close()
      }
    }
  )

  it('recovers a mutation and its scope approval after re-pairing at a nonzero generation and restarting', async () => {
    const fixture = await setup(true)
    try {
      const originalPrincipal = fixture.host().connection('sample-node').principal()
      await fixture.rePair()
      expect(fixture.host().connection('sample-node').authorizationGeneration).toBe(1)
      const approvedPrincipal = fixture.host().connection('sample-node').principal()
      expect(approvedPrincipal).not.toBe(originalPrincipal)
      vi.spyOn(fixture.client(), 'flush').mockImplementation(async () => {
        fixture.connected(false)
        throw new ChannelError('disconnected')
      })
      const first = await fixture.call()
      const operation_id = (first.details as { operation_id: string }).operation_id
      expect(first.details).toMatchObject({ operation_id, state: 'outcome_unknown' })
      expect((await fixture.client().pending()).map((entry) => entry.operation_id)).toEqual([
        operation_id,
      ])
      const reopened = await fixture.restart()
      expect(fixture.host().connection('sample-node').authorizationGeneration).toBe(0)
      fixture.connected(true)
      const receipt = FileMutationResultSchema.parse({
        operation_id,
        workspace_id: 'sample-folder',
        path: 'sample.txt',
        state: 'saved',
        expected_content_id: hash('old'),
        predecessor_content_id: hash('old'),
        content_id: hash('new'),
        recovery_path: null,
      })
      vi.spyOn(reopened, 'flush').mockImplementation(async () => {
        await reopened.store.transaction((state) => {
          expect(state.outbox.map((entry) => entry.operation_id)).toEqual([operation_id])
          state.results[operation_id] = {
            request: { method: 'workspace.write', params: state.outbox[0].params },
            result: receipt,
          }
          state.outbox = []
        })
      })
      const inspect = vi.spyOn(reopened, 'fileMutationResult')
      const retry = await fixture.call('sample-restart-retry', {
        ...args,
        operation_id,
      } as typeof args)
      expect(retry.details).toMatchObject({
        operation_id,
        state: 'saved',
        diff: { old: 'old', new: 'new' },
      })
      expect(inspect).toHaveBeenCalledWith(operation_id)
      expect(reopened.readFile).not.toHaveBeenCalled()
      expect(await reopened.pending()).toEqual([])
      expect(fixture.host().connection('sample-node').principal()).toBe(approvedPrincipal)
      expect(
        fixture.host().ledger.approvedNode(fixture.session, 'sample-node', approvedPrincipal)
      ).toBe(true)
    } finally {
      fixture.close()
    }
  })

  it('fences an in-flight read on a generation change without changing its durable principal', async () => {
    const fixture = await setup(true)
    try {
      const principal = fixture.host().connection('sample-node').principal()
      const workspace = await fixture.client().getWorkspace('sample-folder')
      vi.mocked(fixture.client().getWorkspace).mockImplementation(async () => {
        fixture.advanceGeneration()
        return workspace
      })
      await expect(fixture.callTool('node_read')).rejects.toThrow(/approval|authority/)
      expect(fixture.client().readFile).not.toHaveBeenCalled()
      expect(fixture.host().connection('sample-node').principal()).toBe(principal)
      expect(fixture.host().ledger.approvedNode(fixture.session, 'sample-node', principal)).toBe(
        true
      )
    } finally {
      fixture.close()
    }
  })

  it('retains an admitted write when the generation changes while flushing, without publishing a saved receipt', async () => {
    const fixture = await setup(true)
    try {
      const principal = fixture.host().connection('sample-node').principal()
      vi.spyOn(fixture.client(), 'flush').mockImplementation(async () => {
        fixture.advanceGeneration()
      })
      const inspect = vi.spyOn(fixture.client(), 'fileMutationResult')
      const result = await fixture.call()
      const operation_id = (await fixture.client().pending())[0].operation_id
      expect(result.details).toMatchObject({ operation_id, state: 'outcome_unknown' })
      expect(result.details).not.toHaveProperty('diff')
      expect(inspect).not.toHaveBeenCalled()
      expect(fixture.host().connection('sample-node').principal()).toBe(principal)
    } finally {
      fixture.close()
    }
  })

  it('never retries an old mutation under a newly approved registration authority', async () => {
    const fixture = await setup(true)
    try {
      vi.spyOn(fixture.client(), 'flush').mockImplementation(async () => {
        fixture.connected(false)
        throw new ChannelError('disconnected')
      })
      const first = await fixture.call()
      const operation_id = (first.details as { operation_id: string }).operation_id
      await fixture.rePair()
      fixture.connected(true)
      const write = vi.spyOn(fixture.client(), 'writeFile')
      const inspect = vi.spyOn(fixture.client(), 'fileMutationResult')
      const retry = await fixture.call('sample-repaired-retry', {
        ...args,
        operation_id,
      } as typeof args)
      expect(retry.details).toMatchObject({ operation_id, state: 'outcome_unknown' })
      expect(write).not.toHaveBeenCalled()
      expect(inspect).not.toHaveBeenCalled()
      expect((await fixture.client().pending()).map((entry) => entry.operation_id)).toEqual([
        operation_id,
      ])
    } finally {
      fixture.close()
    }
  })

  it('fences a scope approval if the generation changes while saving', async () => {
    const fixture = await setup(true)
    try {
      const principal = fixture.host().connection('sample-node').principal()
      vi.mocked(fixture.session.saveForRelease).mockImplementation(async () => {
        fixture.advanceGeneration()
      })
      await expect(
        setObsidianChatNodeScope(fixture.session, fixture.session.overrides.value.nodeScope!)
      ).rejects.toThrow(/identity|authority/)
      expect(fixture.host().connection('sample-node').principal()).toBe(principal)
    } finally {
      fixture.close()
    }
  })

  it('fences a shared scope save when the registration is replaced during persistence', async () => {
    const fixture = await setup(true)
    try {
      const principal = fixture.host().connection('sample-node').principal()
      vi.mocked(fixture.session.saveForRelease).mockImplementationOnce(async () => {
        await fixture.rePair()
      })
      await expect(
        setObsidianChatNodeScope(fixture.session, fixture.session.overrides.value.nodeScope!)
      ).rejects.toThrow(/identity|authority/)
      expect(fixture.host().connection('sample-node').principal()).not.toBe(principal)
    } finally {
      fixture.close()
    }
  })

  it('fences a replaced client even when principal and authorization generation stay unchanged', async () => {
    const fixture = await setup(true)
    try {
      const connection = fixture.host().connection('sample-node')
      const principal = connection.principal()
      const generation = connection.authorizationGeneration
      vi.mocked(fixture.session.saveForRelease).mockImplementationOnce(async () => {
        await fixture.restart()
      })
      await expect(
        setObsidianChatNodeScope(fixture.session, fixture.session.overrides.value.nodeScope!)
      ).rejects.toThrow(/identity|authority/)
      const replaced = fixture.host().connection('sample-node')
      expect(replaced.client).not.toBe(connection.client)
      expect(replaced.principal()).toBe(principal)
      expect(replaced.authorizationGeneration).toBe(generation)
    } finally {
      fixture.close()
    }
  })

  it('saves shared scope for an offline node without local approval', async () => {
    const fixture = await setup(true)
    try {
      fixture.connected(false)
      await expect(
        setObsidianChatNodeScope(fixture.session, fixture.session.overrides.value.nodeScope!)
      ).resolves.toBeUndefined()
      expect(fixture.session.overrides.value.nodeScope).toHaveLength(1)
    } finally {
      fixture.close()
    }
  })

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
