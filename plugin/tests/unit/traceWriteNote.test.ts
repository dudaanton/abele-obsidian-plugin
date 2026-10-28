import { expect, it, vi } from 'vitest'
import { Notice } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { writeRunNote } from '@/debugger/trace/runNote'
import { TraceRpc } from '@/debugger/trace/wire'

const save = vi.hoisted(() => vi.fn(async () => ({ path: 'Trace/Sample.md', outside: true })))
vi.mock('@/debugger/trace/notesFolder', () => ({ saveRunNote: save }))
vi.mock('@/node/NodeService', () => ({
  NodeService: { getInstance: () => ({ connection: () => ({}) }) },
}))

it('shows progress immediately and shares repeated clicks until the note finishes', async () => {
  let finish!: (value: unknown) => void
  const request = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const rpc = new TraceRpc(request)
  const state = { registrationId: 'sample-node', projectId: 'sample-project', runId: 'sample-run' }
  Object.assign(GlobalStore.getInstance(), { _app: {} })
  const first = writeRunNote(state, rpc)
  const second = writeRunNote(state, rpc)
  expect(Notice.shown.at(-1)).toBe('Writing a note about this run…')
  expect(request).toHaveBeenCalledOnce()
  finish({
    run: {
      id: state.runId,
      name: 'Sample',
      debug_session_id: 'sample-session',
      started_at: '2026-01-02T03:04:05.000Z',
      state: 'done',
      steps: 0,
      bytes: 0,
    },
    points: [],
    steps: [],
    marks: [],
    folder: '/sample/runs',
  })
  await expect(first).resolves.toBe('Trace/Sample.md')
  await expect(second).resolves.toBe('Trace/Sample.md')
  expect(save).toHaveBeenCalledOnce()
})
