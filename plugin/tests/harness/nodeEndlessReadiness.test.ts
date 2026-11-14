import { expect, it, vi } from 'vitest'
import { ENDLESS_COMPACT, ENDLESS_DIAGNOSTICS } from '../e2e/helpers/nodeEndlessProbe'

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
