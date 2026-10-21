import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import {
  addFolderDebugMenu,
  folderDebugReason,
  commandTarget,
  registerFolderDebugCommands,
} from '@/debugger/folderActions'
import { NodePathService } from '@/node/NodePathService'
import { NodeService } from '@/node/NodeService'
import type { Menu } from 'obsidian'
import { startProgram } from '@/debugger/startProgram'
import { attachToProgram } from '@/debugger/attachProgram'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { FolderDebugOwner } from '@/debugger/owner'
const selected = vi.hoisted(() => ({
  view: null as null | { type: string; state: unknown },
  sidebar: undefined as string | undefined,
}))

vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: {
        workspace: {
          getMostRecentLeaf: () => (selected.view ? { getViewState: () => selected.view } : null),
          getLeavesOfType: () =>
            selected.sidebar
              ? [{ getViewState: () => ({ state: { registrationId: selected.sidebar } }) }]
              : [],
        },
      },
    }),
  },
}))
vi.mock('@/node/nodePathNavigation', () => ({
  NODE_FILE_VIEW: 'sample-file',
  openNodePathTab: vi.fn(async () => {}),
  NodePathTabSchema: { safeParse: (state: unknown) => ({ success: !!state, data: state }) },
}))
afterEach(() => {
  selected.view = null
  selected.sidebar = undefined
  DebuggerService.instance.destroy()
  vi.restoreAllMocks()
})
it('ignores a stale sidebar registration before its view has opened', async () => {
  const target = owner().target
  selected.sidebar = 'sample-removed'
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: ref([{ id: target.registrationId }]),
  } as never)
  vi.spyOn(NodePathService, 'getInstance').mockReturnValue({
    ready: vi.fn(async () => {}),
    model: (id: string) => {
      if (id !== target.registrationId) throw new Error('registration is missing')
      return { current: ref(target) }
    },
  } as never)
  expect(await commandTarget()).toEqual(target)
})
it('falls back to the connected panel folder when a restored file belongs to a removed registration', async () => {
  const target = owner().target
  selected.view = {
    type: 'abele-node-file',
    state: {
      kind: 'file',
      target: { ...target, registrationId: 'sample-removed' },
      path: 'sample.ts',
    },
  }
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: ref([{ id: target.registrationId, expectedNodeId: target.nodeId }]),
  } as never)
  vi.spyOn(NodePathService, 'getInstance').mockReturnValue({
    ready: vi.fn(async () => {}),
    model: () => ({ current: ref(target) }),
  } as never)
  expect(await commandTarget()).toEqual(target)
})

it('resolves a folder for commands before the Node sidebar has ever opened', async () => {
  const target = owner().target
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: ref([{ id: target.registrationId }]),
  } as never)
  vi.spyOn(NodePathService, 'getInstance').mockReturnValue({
    ready: vi.fn(async () => {}),
    model: () => ({ current: ref(target) }),
  } as never)
  expect(await commandTarget()).toEqual(target)
})

it('uses the known folder while the initial file-tree read is still pending', async () => {
  const target = owner().target
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: ref([{ id: target.registrationId }]),
  } as never)
  vi.spyOn(NodePathService, 'getInstance').mockReturnValue({
    ready: vi.fn(() => new Promise<void>(() => {})),
    model: () => ({ current: ref(target) }),
  } as never)
  const deadline = new Promise((resolve) => window.setTimeout(() => resolve('still waiting'), 25))
  expect(await Promise.race([commandTarget(), deadline])).toEqual(target)
})

it('uses a folder selected during startup without waiting for its first tree listing', async () => {
  const target = owner().target
  const current = ref<typeof target>()
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: ref([{ id: target.registrationId }]),
  } as never)
  vi.spyOn(NodePathService, 'getInstance').mockReturnValue({
    ready: vi.fn(() => new Promise<void>(() => {})),
    model: () => ({ current }),
  } as never)
  const pending = commandTarget()
  current.value = target
  const deadline = new Promise((resolve) => window.setTimeout(() => resolve('still waiting'), 25))
  expect(await Promise.race([pending, deadline])).toEqual(target)
})

it('handles folder startup failures in the command instead of rejecting silently', async () => {
  const target = owner().target
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: ref([{ id: target.registrationId }]),
  } as never)
  vi.spyOn(NodePathService, 'getInstance').mockReturnValue({
    model: () => ({ current: ref(undefined) }),
    ready: vi.fn(async () => {
      throw new Error('offline')
    }),
  } as never)
  const commands: { id: string; callback: () => Promise<void> }[] = []
  registerFolderDebugCommands({
    addCommand: (command: (typeof commands)[number]) => commands.push(command),
  } as never)
  await expect(
    commands.find((command) => command.id === 'node-folder-debug-attach')!.callback()
  ).resolves.toBeUndefined()
})

// Native menus freeze their rows at show time, ignoring subsequent item mutations.
it.each(['ready', 'refused', 'reconnected', 'offline'])(
  'settles delayed %s readiness before the native snapshot',
  async (state) => {
    const context = owner()
    vi.spyOn(NodeService, 'getInstance').mockReturnValue({
      connection: () => context.connection,
    } as never)
    let release!: () => void
    const delayed = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(context.connection.client.describe).mockImplementationOnce(async () => {
      await delayed
      return {
        capabilities: {
          capabilities: { debugger_v1: { status: 'supported', evidence: 'sample' } },
        },
      } as never
    })
    if (state === 'refused')
      vi.mocked(context.connection.client.request).mockRejectedValueOnce(
        new Error('Permission refused')
      )
    const rows: { title: string; disabled: boolean }[] = []
    let snapshot: typeof rows = []
    const menu = {
      addItem(build: (item: unknown) => void) {
        const row = { title: '', disabled: false }
        rows.push(row)
        const item = {
          setTitle(title: string) {
            row.title = title
            return item
          },
          setDisabled(disabled: boolean) {
            row.disabled = disabled
            return item
          },
          setIcon() {
            return item
          },
          onClick() {
            return item
          },
        }
        build(item)
      },
      showAtPosition() {
        snapshot = structuredClone(rows)
      },
    }
    const display = (async () => {
      await addFolderDebugMenu(menu as unknown as Menu, context.target)
      menu.showAtPosition()
    })()
    await Promise.resolve()
    expect(snapshot).toEqual([])
    if (state === 'reconnected' || state === 'offline') context.connection.state.value = 'offline'
    if (state === 'reconnected') context.connection.state.value = 'connected'
    release()
    await display
    expect(snapshot).toHaveLength(3)
    expect(snapshot.every((row) => row.disabled === (state !== 'ready'))).toBe(true)
    expect(snapshot.some((row) => /Checking/.test(row.title))).toBe(false)
    if (state === 'refused') expect(snapshot[0].title).toContain('Permission refused')
    if (state === 'reconnected' || state === 'offline')
      expect(snapshot[0].title).toMatch(/Reconnect/)
  }
)
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
it.each(['generation', 'target', 'reconnect', 'failure'])(
  'rejects %s changes during the final profile check without caching readiness',
  async (change) => {
    const context = owner()
    let generation = 0
    Object.defineProperty(context.connection, 'authorizationGeneration', { get: () => generation })
    const target = { url: 'ws://sample.invalid/channel' }
    Object.defineProperty(context.connection.client, 'target', { value: target })
    const request = vi.mocked(context.connection.client.request)
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    request
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => {
        await pending
        if (change === 'failure') throw new Error('Profile check refused')
        return [{ id: 'js-ts-native' }]
      })
    const checking = folderDebugReason(context)
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('debugger.v1.profiles', {}))
    if (change === 'generation') generation++
    if (change === 'target') target.url = 'ws://other.invalid/channel'
    if (change === 'reconnect') {
      context.connection.state.value = 'offline'
      context.connection.state.value = 'connected'
    }
    release()
    expect(await checking).toMatch(change === 'failure' ? /Profile check refused/ : /Reconnect/)
    expect(await folderDebugReason(context)).toBe('')
  }
)
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
it('keeps message-less negotiation failures disabled', async () => {
  const context = owner()
  vi.mocked(context.connection.client.describe).mockRejectedValueOnce(new Error(''))
  expect(await folderDebugReason(context)).toMatch(/off/)
  vi.mocked(context.connection.client.request).mockRejectedValueOnce(new Error(''))
  expect(await folderDebugReason(context)).toMatch(/off/)
})

it.each(['describe', 'sessions', 'profiles'])(
  'retains current-peer %s failures offline but discards failures after peer replacement',
  async (stage) => {
    for (const change of ['offline', 'reconnected', 'retry-failed', 'generation', 'target']) {
      const context = owner()
      let generation = 0
      Object.defineProperty(context.connection, 'authorizationGeneration', {
        get: () => generation,
      })
      const target = { url: 'ws://sample.invalid/channel' }
      Object.defineProperty(context.connection.client, 'target', { value: target })
      let enter!: () => void, release!: () => void
      const entered = new Promise<void>((resolve) => {
        enter = resolve
      })
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      const fail = async () => {
        enter()
        await pending
        throw new Error('No answer from the node. Reconnecting.')
      }
      if (stage === 'describe')
        vi.mocked(context.connection.client.describe).mockImplementationOnce(fail)
      else
        vi.mocked(context.connection.client.request).mockImplementation(async (method) => {
          if (method === `debugger.v1.${stage}`) return fail()
          return []
        })
      const checking = folderDebugReason(context)
      await entered
      context.connection.state.value = 'offline'
      if (change === 'reconnected') context.connection.state.value = 'connected'
      if (change === 'retry-failed') {
        context.connection.state.value = 'connecting'
        context.connection.state.value = 'offline'
      }
      if (change === 'generation') generation++
      if (change === 'target') target.url = 'ws://other.invalid/channel'
      release()
      expect(await checking, `${stage}/${change}`).toBe(
        change === 'offline' ? 'No answer from the node. Reconnecting.' : 'Reconnect to the node'
      )
    }
  }
)
