// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { runGatePhase } from '../e2e/helpers/syncPhoneGatePhases'
import { syncDesktopGateReplica } from '../e2e/helpers/syncPhoneDesktop'

const { open } = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('../../node_modules/@abele/sync-sdk/dist/node-replica.js', () => ({ openReplica: open }))
afterEach(() => vi.useRealTimers())

it('cancels desktop I/O and drains the engine before closing its ledger on a phase deadline', async () => {
  vi.useFakeTimers()
  const events: string[] = []
  let finish!: () => void
  let networkSignal: AbortSignal | undefined
  const engine = {
    sync: () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    pause: () => {
      events.push('pause')
      finish()
    },
    stop: async () => {
      events.push('stop')
    },
  }
  open.mockImplementationOnce(async (options) => {
    await options.fetch('https://sync.example.invalid/v2/connection')
    return { buildEngine: () => engine, close: () => events.push('close') }
  })
  const run = runGatePhase('desktop replica', 100, (signal) =>
    syncDesktopGateReplica({
      key: 'sample-token',
      dir: 'sample-files',
      stateDir: 'sample-state',
      signal,
      fetch: async (_input, init) => {
        networkSignal = init?.signal as AbortSignal
        return new Response()
      },
    })
  )
  const failed = expect(run).rejects.toThrow('desktop replica exceeded 100 ms')
  await vi.advanceTimersByTimeAsync(100)
  await failed
  expect(networkSignal?.aborted).toBe(true)
  expect(events).toEqual(['pause', 'stop', 'close'])
})
