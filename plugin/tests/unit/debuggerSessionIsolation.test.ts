import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { FolderDebugOwner } from '@/debugger/owner'
import { debuggerSnapshot } from '../fixtures/debugger'

vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { workspace: {} } }) },
}))

const service = new DebuggerService()
it('retains breakpoint paths learned from stack metadata without requiring an open file tab', () => {
  const owner = {
    kind: 'folder-debug',
    target: {
      registrationId: 'sample-registration',
      nodeId: 'sample-node',
      projectId: 'sample-project',
      kind: 'worktree',
      id: 'sample-tree',
    },
    connection: { state: ref('connected') },
  } as unknown as FolderDebugOwner
  const binding = service.binding(owner, 'sample-debug')
  binding.controller.observe({
    observation: 'current',
    snapshot: debuggerSnapshot({
      breakpoints: [
        {
          breakpoint_id: 'sample-point',
          source_id: 'sample-source',
          line: 5,
          status: 'verified',
          resolved_line: 5,
          resolved_column: null,
          message: null,
        },
      ],
    }),
  })
  binding.controller.registerSource('sample-source', 'src/sample.ts')
  service.select(binding)
  expect(service.selectionState()).toMatchObject({
    sources: [{ sourceId: 'sample-source', path: 'src/sample.ts', sessionId: 'sample-debug' }],
  })
})
it('brings a newly paused peer forward only within the selected folder', () => {
  const owner = {
    kind: 'folder-debug',
    target: {
      registrationId: 'sample-registration',
      nodeId: 'sample-node',
      kind: 'worktree',
      id: 'sample-tree',
    },
    connection: { state: ref('connected') },
  } as unknown as FolderDebugOwner
  const first = service.binding(owner, 'sample-first')
  const paused = service.binding(owner, 'sample-paused')
  service.select(first)
  service.focusPause(paused)
  expect(service.active.value).toBe(paused)
  const other = service.binding(
    { ...owner, target: { ...owner.target, id: 'sample-other-tree' } },
    'sample-other'
  )
  service.focusPause(other)
  expect(service.active.value).toBe(paused)
})
it('prefers a live process over its selected detached observation', async () => {
  const owner = {
    kind: 'folder-debug',
    target: {
      registrationId: 'sample-registration',
      nodeId: 'sample-node',
      kind: 'worktree',
      id: 'sample-tree',
    },
    connection: { state: ref('connected') },
  } as unknown as FolderDebugOwner
  const bindings = ['sample-old', 'sample-live'].map((id, index) => {
    const binding = service.binding(owner, id)
    const snapshot = debuggerSnapshot({
      debug_session_id: id,
      lifecycle: index ? 'active' : 'detached',
    })
    snapshot.target.process_ownership = 'external'
    snapshot.target.launch_configuration_id = 'sample.cjs · pid 4101'
    binding.controller.observe({ observation: 'current', snapshot })
    return binding
  })
  service.select(bindings[0])
  expect(service.peers(bindings[0])).toEqual([bindings[1]])
  vi.spyOn(service, 'sessions').mockResolvedValue(
    bindings.map((binding) => binding.controller.snapshot!)
  )
  await service.discover(owner)
  expect(service.active.value).toBe(bindings[1])
})
afterEach(() => {
  service.destroy()
  vi.restoreAllMocks()
})
it('does not reuse an old chat observation while it is opening a different session', async () => {
  const target = {
    registrationId: 'sample-registration',
    nodeId: 'sample-node',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-tree',
  }
  let finish!: (value: unknown) => void
  const response = new Promise((resolve) => {
    finish = resolve
  })
  const connection = {
    state: ref('connected'),
    client: { debugger: { status: vi.fn(() => response) } },
  }
  const chat = {
    reference: { registrationId: target.registrationId, sessionId: 'sample-chat' },
    connection,
  } as never
  const binding = service.binding(chat)
  binding.controller.observe({
    observation: 'current',
    snapshot: debuggerSnapshot({ debug_session_id: 'sample-old' }),
  })
  service.trackFolder(chat, 'sample-old', target)
  const opening = binding.open('sample-new')
  try {
    expect(
      service.binding({ kind: 'folder-debug', target, connection } as never, 'sample-old')
    ).not.toBe(binding)
  } finally {
    binding.destroy()
    finish({ snapshot: debuggerSnapshot({ debug_session_id: 'sample-new' }) })
    await opening
  }
})
it('restores source identities and attachment keys for every primary session', async () => {
  const target = {
    registrationId: 'sample-registration',
    nodeId: 'sample-node',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-tree',
  }
  const owner = {
    kind: 'folder-debug',
    target,
    connection: { state: ref('connected'), connect: vi.fn(async () => {}) },
  } as unknown as FolderDebugOwner
  const ids = ['sample-first', 'sample-second']
  const snapshots = ids.map((id) => debuggerSnapshot({ debug_session_id: id }))
  const first = service.binding(owner, ids[0]),
    second = service.binding(owner, ids[1])
  for (const [index, binding] of [first, second].entries()) {
    binding.controller.observe({ observation: 'current', snapshot: snapshots[index] })
    binding.controller.session.watches = [{ expression: `sample${index}.count`, value: '42' }]
    binding.attachmentKey = String(index + 1).repeat(64)
    service.registerSource(
      binding.registrationId,
      binding.conversationId,
      'sample-source',
      `src/sample-${index}.ts`,
      ids[index],
      'sample-incarnation',
      target
    )
  }
  service.select(first)
  const saved = service.selectionState()
  service.destroy()
  const restored = ids.map((id, index) => {
    const binding = service.binding(owner, id)
    vi.spyOn(binding, 'open').mockImplementation(async () => {
      binding.controller.observe({ observation: 'current', snapshot: snapshots[index] })
    })
    return binding
  })
  vi.spyOn(service, 'discover').mockResolvedValue()
  await service.restoreSelection(saved, () => owner)
  service.select(restored[1])
  expect(restored[1].attachmentKey).toBe('2'.repeat(64))
  expect(restored[1].controller.session.watches).toEqual([
    { expression: 'sample1.count', stale: true },
  ])
  expect(JSON.stringify(saved)).not.toContain('42')
  expect(service.debugFor(target, 'src/sample-1.ts')?.debugSessionId).toBe(ids[1])
})
it('observes every saved primary session before discovering native mirror records', async () => {
  const target = {
    registrationId: 'sample-registration',
    nodeId: 'sample-node',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-tree',
  }
  const owner = {
    kind: 'folder-debug',
    target,
    connection: { state: ref('connected'), connect: vi.fn(async () => {}) },
  } as unknown as FolderDebugOwner
  const bindings = ['sample-first', 'sample-second'].map((id) => {
    const binding = service.binding(owner, id)
    vi.spyOn(binding, 'open').mockImplementation(async () => {
      binding.controller.observe({
        observation: 'current',
        snapshot: debuggerSnapshot({ debug_session_id: id }),
      })
    })
    return binding
  })
  vi.spyOn(service, 'discover').mockResolvedValue()
  await service.restoreSelection(
    { sessionId: 'sample-first', sessions: ['sample-first', 'sample-second'], target, sources: [] },
    () => owner
  )
  expect(bindings[1].open).toHaveBeenCalledExactlyOnceWith('sample-second')
  expect(service.active.value).toBe(bindings[0])
  expect(service.peers(bindings[0])).toEqual(bindings)
})
it('retains the saved selection with its offline reason if reconnecting cannot complete', async () => {
  const target = {
    registrationId: 'sample-registration',
    nodeId: 'sample-node',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-tree',
  }
  const owner = {
    kind: 'folder-debug',
    target,
    connection: {
      state: ref('offline'),
      connect: vi.fn(async () => {
        throw new Error('Sample node is offline')
      }),
    },
  } as unknown as FolderDebugOwner
  const saved = { sessionId: 'sample-debug', target, sessions: ['sample-debug'], sources: [] }
  await expect(service.restoreSelection(saved, () => owner)).rejects.toThrow(
    'Sample node is offline'
  )
  expect(service.selectionState()).toMatchObject({ sessionId: 'sample-debug', target })
  expect(service.active.value?.controller.session.status).toBe('lost')
  expect(service.active.value?.controller.error).toBe('Sample node is offline')
})
it.each(['external', 'owned'] as const)(
  'shows one observation per %s process when native and driver session IDs differ',
  (ownership) => {
    const owner = {
      kind: 'folder-debug',
      target: {
        registrationId: 'sample-registration',
        nodeId: 'sample-node',
        kind: 'worktree',
        id: 'sample-tree',
      },
      connection: { state: ref('connected') },
    } as unknown as FolderDebugOwner
    const bindings = ['sample-first', 'sample-mirror', 'sample-second'].map((id, i) => {
      const binding = service.binding(owner, id)
      const snapshot = debuggerSnapshot({ debug_session_id: id })
      snapshot.target.process_ownership = ownership
      snapshot.target.launch_configuration_id = `sample.cjs · pid ${i < 2 ? 4101 : 4102}`
      if (i === 0 || ownership === 'owned')
        snapshot.target.process_evidence = {
          pid: i < 2 ? 4101 : 4102,
          ownership_id: 'sample-ownership',
          start_identity: 'sample-process-start',
          executable_sha256: 'a'.repeat(64),
        }
      binding.controller.observe({ observation: 'current', snapshot })
      return binding
    })
    service.select(bindings[0])
    expect(service.peers(bindings[0])).toEqual([bindings[0], bindings[2]])
  }
)
it('keeps a restored selection while its folder reconnects before the snapshot arrives', () => {
  const owner = {
    kind: 'folder-debug',
    target: {
      registrationId: 'sample-registration',
      nodeId: 'sample-node',
      kind: 'worktree',
      id: 'sample-tree',
    },
    connection: { state: ref('connected') },
  } as unknown as FolderDebugOwner
  const binding = service.binding(owner, 'sample-debug')
  service.select(binding)
  service.selectFolder(owner.target)
  expect(service.active.value).toBe(binding)
})
it('reuses an observed session when the same folder opens it from another owner surface', () => {
  const connection = { state: ref('connected') }
  const target = {
    registrationId: 'sample-registration',
    nodeId: 'sample-node',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-tree',
  }
  const chat = {
    connection,
    reference: { registrationId: target.registrationId, sessionId: 'sample-chat' },
  } as never
  service.trackFolder(chat, 'sample-debug', target)
  const binding = service.binding(chat)
  binding.controller.observe({ observation: 'current', snapshot: debuggerSnapshot() })
  const folder = { kind: 'folder-debug', connection, target } as unknown as FolderDebugOwner
  expect(service.binding(folder, 'sample-debug')).toBe(binding)
})
it('restores the selected folder session and its source mappings from view state', async () => {
  const owner = {
    kind: 'folder-debug',
    target: {
      registrationId: 'sample-registration',
      nodeId: 'sample-node',
      projectId: 'sample-project',
      kind: 'worktree',
      id: 'sample-tree',
    },
    connection: { state: ref('connected'), connect: vi.fn(async () => {}) },
  } as unknown as FolderDebugOwner
  const binding = service.binding(owner, 'sample-debug')
  binding.controller.observe({ observation: 'current', snapshot: debuggerSnapshot() })
  service.registerSource(
    binding.registrationId,
    binding.conversationId,
    'sample-source',
    'src/sample.ts',
    'sample-debug',
    'sample-incarnation',
    owner.target
  )
  service.select(binding)
  const state = service.selectionState()
  expect(state).toMatchObject({ sessions: ['sample-debug'] })
  service.destroy()
  const restored = service.binding(owner, 'sample-debug')
  vi.spyOn(restored, 'open').mockImplementation(async () => {
    restored.controller.observe({ observation: 'current', snapshot: debuggerSnapshot() })
  })
  vi.spyOn(service, 'discover').mockResolvedValue()
  await service.restoreSelection(state, () => owner)
  expect(restored.open).toHaveBeenCalledWith('sample-debug')
  expect(service.active.value).toBe(restored)
  expect(service.debugFor(owner.target, 'src/sample.ts')?.sourceId).toBe('sample-source')
})
it('discovers each retained folder session once without replacing the chosen session', async () => {
  const snapshots = ['sample-first', 'sample-second', 'sample-first'].map((id) =>
    debuggerSnapshot({ debug_session_id: id })
  )
  const owner = {
    kind: 'folder-debug',
    target: {
      registrationId: 'sample-registration',
      nodeId: 'sample-node',
      kind: 'worktree',
      id: 'sample-tree',
    },
    connection: { state: ref('connected') },
  } as unknown as FolderDebugOwner
  vi.spyOn(service, 'sessions').mockResolvedValue(snapshots)
  const first = service.binding(owner, 'sample-first')
  const second = service.binding(owner, 'sample-second')
  for (const [binding, id] of [
    [first, 'sample-first'],
    [second, 'sample-second'],
  ] as const)
    vi.spyOn(binding, 'open').mockImplementation(async () => {
      binding.controller.observe({
        observation: 'current',
        snapshot: debuggerSnapshot({ debug_session_id: id }),
      })
    })
  service.select(first)
  await service.discover(owner)
  expect(service.peers(first)).toEqual([first, second])
  expect(service.active.value).toBe(first)
  expect(first.open).toHaveBeenCalledTimes(1)
  expect(second.open).toHaveBeenCalledTimes(1)
})
it('keeps folder sessions independent and uses the selected session for file margins', () => {
  const owner = {
    kind: 'folder-debug',
    target: {
      registrationId: 'sample-registration',
      nodeId: 'sample-node',
      kind: 'worktree',
      id: 'sample-tree',
    },
    connection: { state: ref('connected') },
  } as unknown as FolderDebugOwner
  const first = service.binding(owner, 'sample-first')
  const second = service.binding(owner, 'sample-second')
  expect(first).not.toBe(second)
  for (const [binding, id] of [
    [first, 'sample-first'],
    [second, 'sample-second'],
  ] as const) {
    binding.controller.observe({
      observation: 'current',
      snapshot: debuggerSnapshot({ debug_session_id: id }),
    })
    service.registerSource(
      binding.registrationId,
      binding.conversationId,
      'sample-source',
      'src/sample.ts',
      id,
      'sample-incarnation',
      owner.target
    )
  }
  service.select(second)
  expect(service.folderBinding(owner.target)).toBe(second)
  expect(service.debugFor(owner.target, 'src/sample.ts')?.debugSessionId).toBe('sample-second')
  service.select(first)
  expect(service.folderBinding(owner.target)).toBe(first)
  expect(service.debugFor(owner.target, 'src/sample.ts')?.debugSessionId).toBe('sample-first')
  service.selectFolder({ ...owner.target, id: 'sample-other-tree' })
  expect(service.active.value).toBeNull()
  service.selectFolder(owner.target)
  expect(service.active.value).toBe(first)
  service.select(second)
  service.selectFolder({ ...owner.target, id: 'sample-other-tree' })
  service.selectFolder(owner.target)
  expect(service.active.value).toBe(second)
  first.attachmentKey = second.attachmentKey = 'sample-program'
  expect(service.forAttachment(owner, 'sample-program')).toBe(second)
})
