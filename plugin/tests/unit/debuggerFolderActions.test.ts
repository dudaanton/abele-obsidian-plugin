import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { folderDebugReason } from '@/debugger/folderActions'
import { startProgram } from '@/debugger/startProgram'
import { attachToProgram } from '@/debugger/attachProgram'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { FolderDebugOwner } from '@/debugger/owner'

vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: { workspace: { getMostRecentLeaf: () => null, getLeavesOfType: () => [] } },
    }),
  },
}))
vi.mock('@/node/nodePathNavigation', () => ({
  NODE_FILE_VIEW: 'sample-file',
  openNodePathTab: vi.fn(async () => {}),
  NodePathTabSchema: { safeParse: () => ({ success: false }) },
}))
afterEach(() => {
  DebuggerService.instance.destroy()
  vi.restoreAllMocks()
})
function owner() {
  const request = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'debugger.v1.sessions') return []
    if (method === 'debugger.v1.profiles')
      return [{ id: 'js-ts-native', version: 'sample', inspection: 'native' }]
    if (method === 'debugger.v1.status') return { snapshot: { incarnation: 'sample-incarnation' } }
    return { debug_session_id: 'sample-debug', sources: [] }
  })
  const describe = vi.fn(async () => ({
    capabilities: { capabilities: { debugger_v1: { status: 'supported', evidence: 'sample' } } },
  }))
  return {
    kind: 'folder-debug',
    target: {
      registrationId: 'sample-registration',
      nodeId: 'sample-node',
      projectId: 'sample-project',
      kind: 'worktree',
      id: 'sample-worktree',
    },
    connection: { state: ref('connected'), connect: async () => {}, client: { request, describe } },
  } as unknown as FolderDebugOwner
}
it('starts and attaches using only the selected folder owner', async () => {
  const context = owner()
  const show = vi.fn(async () => {})
  await startProgram(context, 'sample.js', [], context.target, show)
  expect(context.connection.client.request).toHaveBeenCalledWith(
    'debugger.v1.start',
    expect.objectContaining({ folder: { kind: 'worktree', worktree_id: 'sample-worktree' } })
  )
  await attachToProgram(
    context,
    {
      pid: 321,
      port: 9229,
      command: 'node sample.js',
      cwd: '/sample',
      script: '/sample/sample.js',
      project: null,
      in_chat_folder: true,
    },
    show
  )
  expect(context.connection.client.request).toHaveBeenCalledWith(
    'debugger.v1.attachProgram',
    expect.objectContaining({ folder: { kind: 'worktree', worktree_id: 'sample-worktree' } })
  )
  for (const [, params] of vi.mocked(context.connection.client.request).mock.calls)
    expect(params).not.toHaveProperty('conversation_id')
  expect(show).toHaveBeenCalledTimes(2)
})
it('negotiates folder support with a read-only listing, then checks installed profiles', async () => {
  const context = owner()
  expect(await folderDebugReason(context)).toBe('')
  expect(context.connection.client.request).toHaveBeenCalledWith('debugger.v1.sessions', {
    folder: { kind: 'worktree', worktree_id: 'sample-worktree' },
    limit: 1,
  })
})
it('explains an old node, a disabled debugger, an absent profile and an offline connection', async () => {
  const context = owner()
  const request = vi.mocked(context.connection.client.request)
  request.mockRejectedValueOnce(new Error('invalid_params'))
  expect(await folderDebugReason(context)).toMatch(/Update/)
  vi.mocked(context.connection.client.describe).mockResolvedValueOnce({
    capabilities: { capabilities: {} },
  } as never)
  expect(await folderDebugReason(context)).toMatch(/off/)
  request.mockImplementation(async (method) => (method === 'debugger.v1.sessions' ? [] : []))
  expect(await folderDebugReason(context)).toMatch(/not installed/)
  context.connection.state.value = 'offline'
  expect(await folderDebugReason(context)).toMatch(/Reconnect/)
})
