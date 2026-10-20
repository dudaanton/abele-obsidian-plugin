import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { FolderDebugOwner } from '@/debugger/owner'
import { debuggerSnapshot } from '../fixtures/debugger'

const service = new DebuggerService()
afterEach(() => {
  service.destroy()
  vi.restoreAllMocks()
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
})
