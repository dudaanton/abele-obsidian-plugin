import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { MemoryClientStore } from '@abele/node-client'
import type { JournalEvent } from '@abele/channel-protocol'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodeConnection } from '@/node/NodeService'
import { mobileBackground } from '@/ai/mobileBackground'

const presenters: NodeChatPresenter[] = []
let audio: {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}
beforeEach(() => {
  vi.useFakeTimers()
  audio = { start: vi.fn(async () => {}), stop: vi.fn(), destroy: vi.fn() }
  mobileBackground.install(audio)
  mobileBackground.configure(true, { whileAgents: true, always: false })
})
afterEach(() => {
  for (const presenter of presenters.splice(0)) presenter.destroy()
  mobileBackground.destroy()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function chat(sessionId = 'sample-session') {
  const store = new MemoryClientStore()
  let seq = 0
  let changed!: (event: JournalEvent) => void
  const interrupt = vi.fn(async () => {})
  const presenter = new NodeChatPresenter(
    {
      kind: 'node-session',
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      sessionId,
      title: 'Sample chat',
    },
    {
      state: ref('connected'),
      client: {
        target: { expected_node_id: 'sample-node' },
        store,
        connected: true,
        onEvent: (callback: typeof changed) => {
          changed = callback
          return () => {}
        },
        interrupt,
      },
    } as unknown as NodeConnection
  )
  presenters.push(presenter)
  const event = async (type: string, run = 'sample-run', data: Record<string, unknown> = {}) => {
    const row: JournalEvent = {
      kind: 'event',
      node_id: 'sample-node',
      stream_id: sessionId,
      seq: ++seq,
      at: '2031-01-01T00:00:00Z',
      actor: { kind: 'node' },
      type,
      data: { run_id: run, ...data },
    }
    await store.transaction((s) => {
      ;(s.events[sessionId] ??= []).push(row)
    })
    changed(row)
    await presenter.refresh()
  }
  return { presenter, event, interrupt, store }
}

it('starts audio on a remote run event and releases it once after completion grace', async () => {
  const f = await chat()
  await f.event('input.accepted', '', { input_id: 'sample-input', text: 'Sample request' })
  expect(audio.start).not.toHaveBeenCalled()
  await f.event('run.started')
  expect(audio.start).toHaveBeenCalledOnce()
  await f.presenter.refresh()
  expect(audio.start).toHaveBeenCalledOnce()
  await f.event('run.completed')
  await vi.advanceTimersByTimeAsync(1999)
  expect(audio.stop).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(audio.stop).toHaveBeenCalledOnce()
})

it('remembers stopping one legacy turn without attributing later turns to the owner', async () => {
  const f = await chat()
  await f.event('turn.started', 'sample-run', { turn_id: 'first-turn' })
  await f.presenter.interrupt('sample-run')
  await f.event('turn.completed', 'sample-run', {
    turn_id: 'first-turn',
    outcome: 'interrupted',
    terminal_reason: null,
  })
  expect(f.presenter.projection.value.messages.at(-1)?.sessionMark?.text).toBe('Stopped by you')
  await f.presenter.refresh()
  expect(f.presenter.projection.value.messages.at(-1)?.sessionMark?.text).toBe('Stopped by you')
  await f.event('turn.started', 'sample-run', { turn_id: 'next-turn' })
  await f.event('turn.completed', 'sample-run', {
    turn_id: 'next-turn',
    outcome: 'interrupted',
    terminal_reason: null,
  })
  expect(
    f.presenter.projection.value.messages
      .filter((m) => m.sessionMark)
      .map((m) => m.sessionMark?.text)
  ).toEqual(['Stopped by you', 'The agent run ended on the node'])
})

it('keeps audio for an active run waiting on approval, not just the running presentation state', async () => {
  const f = await chat()
  await f.event('run.started')
  await f.event('prompt.opened', 'sample-run', {
    kind: 'permission',
    prompt_id: 'sample-prompt',
    session_id: 'sample-session',
    revision: 1,
    action_digest: 'a'.repeat(64),
    expires_at: Date.now() + 60_000,
    state: 'pending',
    choice: null,
    installation_id: null,
    delivered: false,
    tool_name: 'sample_tool',
    input: {},
  })
  expect(f.presenter.projection.value.state).toBe('needs-attention')
  await vi.advanceTimersByTimeAsync(3000)
  expect(audio.stop).not.toHaveBeenCalled()
  await f.presenter.interrupt('sample-run')
  await vi.advanceTimersByTimeAsync(2000)
  expect(audio.stop).toHaveBeenCalledOnce()
})

it.each(['run.failed', 'run.interrupted'])(
  'releases audio on %s without needing a connected socket',
  async (type) => {
    const f = await chat()
    await f.event('run.started')
    f.presenter.connection.state.value = 'offline'
    await f.event(type)
    await vi.advanceTimersByTimeAsync(2000)
    expect(audio.stop).toHaveBeenCalledOnce()
  }
)

it('Stop releases immediately into grace, even while its acknowledgement is pending or fails', async () => {
  const f = await chat()
  await f.event('run.started')
  let reject!: (error: Error) => void
  f.interrupt.mockImplementation(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail
      })
  )
  const stopped = f.presenter.interrupt('sample-run')
  await vi.advanceTimersByTimeAsync(2000)
  expect(audio.stop).toHaveBeenCalledOnce()
  reject(new Error('Sample interrupted connection'))
  await stopped
  await f.presenter.refresh()
  expect(audio.start).toHaveBeenCalledOnce()
  await f.event('run.completed')
  await f.event('run.started', 'sample-next-run')
  expect(audio.start).toHaveBeenCalledTimes(2)
})

it('keeps overlapping local and remote runs alive and releases an open chat on destroy', async () => {
  const first = await chat('sample-first-session')
  const second = await chat('sample-second-session')
  const endLocal = mobileBackground.beginTurn()
  await first.event('run.started')
  await second.event('run.started')
  endLocal()
  first.presenter.destroy()
  await vi.advanceTimersByTimeAsync(2000)
  expect(audio.stop).not.toHaveBeenCalled()
  second.presenter.destroy()
  second.presenter.destroy()
  await vi.advanceTimersByTimeAsync(2000)
  expect(audio.stop).toHaveBeenCalledOnce()
  // The remote run is still in its journal, but a closed chat owns no audio.
  await second.presenter.refresh()
  expect(audio.start).toHaveBeenCalledOnce()
})

it('acquires audio when an already-active remote run is restored into an open chat', async () => {
  const f = await chat()
  await f.event('run.started')
  f.presenter.destroy()
  await vi.advanceTimersByTimeAsync(2000)
  expect(audio.stop).toHaveBeenCalledOnce()
  const reopened = new NodeChatPresenter(f.presenter.reference, f.presenter.connection)
  presenters.push(reopened)
  await reopened.refresh()
  expect(audio.start).toHaveBeenCalledTimes(2)
})

it.each([false, true])(
  'retains audio-off behavior on mobile and desktop (desktop=%s)',
  async (desktop) => {
    mobileBackground.configure(!desktop, { whileAgents: desktop, always: false })
    const f = await chat()
    await f.event('run.started')
    expect(audio.start).not.toHaveBeenCalled()
    await f.event('run.completed')
    await vi.advanceTimersByTimeAsync(2000)
    expect(audio.stop).not.toHaveBeenCalled()
  }
)
