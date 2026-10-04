import { describe, expect, it, vi } from 'vitest'
import { confirmReload, type ReloadWitness } from '../e2e/helpers/reloadWitness'

const initial: ReloadWitness = {
  owner: 'sample-window',
  generation: 100,
  requestId: null,
  mobile: false,
  apiReady: true,
  layoutReady: true,
}
const changed = (extra: Partial<ReloadWitness> = {}): ReloadWitness => ({
  ...initial,
  generation: 200,
  requestId: 'sample-request',
  mobile: true,
  ...extra,
})
function ports(request: () => string, witnesses: ReloadWitness[]) {
  let time = 0,
    index = 0
  return {
    request: vi.fn(request),
    read: vi.fn(() => witnesses[Math.min(index++, witnesses.length - 1)]),
    pause: async (ms: number) => {
      time += ms
    },
    now: () => time,
  }
}

describe('reload acknowledgment versus document witness', () => {
  it('recovers a lost reply only after the exact request caused a proven ready transition', async () => {
    const io = ports(() => {
      throw new Error('sample lost reply')
    }, [initial, changed({ apiReady: false }), changed({ layoutReady: false }), changed()])
    const result = await confirmReload(initial, 'sample-request', true, io, 1500)
    expect(result.acknowledged).toBe(false)
    expect(result.requestError).toContain('sample lost reply')
    expect(result.witness).toEqual(changed())
    expect(io.request).toHaveBeenCalledOnce()
    expect(io.read).toHaveBeenCalledTimes(4)
  })

  it('waits for a changed generation even when the launch was acknowledged', async () => {
    const io = ports(() => 'sample-request', [initial, changed()])
    expect(
      (await confirmReload(initial, 'sample-request', true, io, 1000)).witness.generation
    ).toBe(200)
    expect(io.request).toHaveBeenCalledOnce()
  })

  it.each([
    ['no transition', initial],
    ['marker without transition', { ...initial, requestId: 'sample-request' }],
    ['unrelated transition', changed({ requestId: 'other-request' })],
    ['foreign owner', changed({ owner: 'other-window' })],
    ['wrong mobile wish', changed({ mobile: false })],
    ['API not ready', changed({ apiReady: false })],
    ['layout not ready', changed({ layoutReady: false })],
  ])(
    'fails explicitly on %s without replaying a possibly executed request',
    async (_name, witness) => {
      const io = ports(() => {
        throw new Error('sample lost reply')
      }, [witness])
      await expect(confirmReload(initial, 'sample-request', true, io, 500)).rejects.toThrow(
        /reload.*unconfirmed/i
      )
      expect(io.request).toHaveBeenCalledOnce()
    }
  )

  it('observes transient read failures but never retries the mutation', async () => {
    const io = ports(() => 'sample-request', [changed()])
    io.read.mockImplementationOnce(() => {
      throw new Error('sample document loading')
    })
    const result = await confirmReload(initial, 'sample-request', true, io, 1000)
    expect(result.witness).toEqual(changed())
    expect(io.request).toHaveBeenCalledOnce()
  })
})
