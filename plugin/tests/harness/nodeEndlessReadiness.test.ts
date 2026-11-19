import { expect, it, vi } from 'vitest'
import {
  ENDLESS_COMPACT,
  ENDLESS_DIAGNOSTICS,
  ENDLESS_TURN_READY,
} from '../e2e/helpers/nodeEndlessProbe'

it('waits for reconnect before compacting and still requires the rendered compaction', async () => {
  let connected = false
  let compacted = false
  const compact = vi.fn(async () => {
    expect(connected).toBe(true)
    compacted = true
  })
  const waitFor = vi.fn(async (predicate: () => boolean) => {
    if (!predicate()) connected = true
    expect(predicate()).toBe(true)
  })
  await new Function(
    'connection',
    'client',
    'presenter',
    'chat',
    'waitFor',
    `return (async()=>{${ENDLESS_COMPACT}})()`
  )(
    {
      state: {
        get value() {
          return connected ? 'connected' : 'connecting'
        },
      },
    },
    {
      get connected() {
        return connected
      },
    },
    () => ({ control: { compact } }),
    () => ({ querySelectorAll: () => (compacted ? [{ textContent: 'Compacted' }] : []) }),
    waitFor
  )
  expect(compact).toHaveBeenCalledOnce()
  expect(waitFor).toHaveBeenCalledTimes(2)
})

it('reports session, projection, events and DOM when completion times out', async () => {
  const run = new Function(
    'connection',
    'client',
    'presenter',
    'chat',
    'document',
    'sid',
    'until',
    `return (async()=>{${ENDLESS_DIAGNOSTICS}
      recordEvent({stream_id:sid,type:'compaction.completed',seq:42,data:{result:'success'}});
      recordEvent({stream_id:'other',type:'turn.started',seq:43});
      await waitFor(()=>false,'Compaction');
    })()`
  )
  const result = run(
    { state: { value: 'connected' } },
    { connected: true },
    () => ({
      error: { value: 'sample refusal' },
      draftNotice: { value: '' },
      isStreaming: { value: false },
      control: { state: { value: { process: 'idle' } } },
      projection: { value: { state: 'idle' } },
      messages: { value: [] },
    }),
    () => null,
    { visibilityState: 'visible' },
    'sample-session',
    async () => {
      throw Error('Compaction did not happen')
    }
  )
  await expect(result).rejects.toThrow('Compaction did not happen;')
  await expect(result).rejects.toThrow('"session":{"process":"idle"}')
  await expect(result).rejects.toThrow('"result":"success"')
  await expect(result).rejects.toThrow('"labels":[]')
})

it('does not accept command completion when no compacted marker renders', async () => {
  const run = new Function(
    'connection',
    'client',
    'presenter',
    'chat',
    'waitFor',
    `return (async()=>{${ENDLESS_COMPACT}})()`
  )
  await expect(
    run(
      { state: { value: 'connected' } },
      { connected: true },
      () => ({ control: { compact: async () => {} } }),
      () => ({ querySelectorAll: () => [] }),
      async (predicate: () => boolean, label: string) => {
        if (!predicate()) throw Error(label + ' did not happen')
      }
    )
  ).rejects.toThrow('Compaction did not happen')
})

it('observes a settled rendered turn independently of convenience refs', () => {
  const answer = { role: 'assistant', nodeTurnId: 'sample-turn', content: 'sample word11: done' }
  const ready = new Function(
    'presenter',
    'chat',
    'completedTurns',
    `${ENDLESS_TURN_READY};return turnReady`
  )(
    () => ({
      projection: { value: { state: 'idle', messages: [answer] } },
      messages: { value: [] },
      isStreaming: { value: true },
    }),
    () => ({ querySelectorAll: () => [{ textContent: answer.content }] }),
    new Set(['sample-turn'])
  )
  expect(ready('sample')).toBe(true)
})

it('requires the matching successful turn, idle projection and rendered final words', () => {
  let state = 'running'
  let rendered = ''
  const completedTurns = new Set<string>()
  const answer = { role: 'assistant', nodeTurnId: 'sample-turn', content: 'sample word11: done' }
  const ready = new Function(
    'presenter',
    'chat',
    'completedTurns',
    `${ENDLESS_TURN_READY};return turnReady`
  )(
    () => ({
      projection: {
        value: {
          get state() {
            return state
          },
          messages: [answer],
        },
      },
      messages: { value: [answer] },
      isStreaming: { value: false },
    }),
    () => ({ querySelectorAll: () => [{ textContent: rendered }] }),
    completedTurns
  )
  expect(ready('sample')).toBe(false)
  state = 'idle'
  expect(ready('sample')).toBe(false)
  completedTurns.add('other-turn')
  rendered = answer.content
  expect(ready('sample')).toBe(false)
  completedTurns.add('sample-turn')
  rendered = 'sample word0: partial'
  expect(ready('sample')).toBe(false)
  rendered = answer.content
  expect(ready('sample')).toBe(true)
  expect(ready('other')).toBe(false)
})
