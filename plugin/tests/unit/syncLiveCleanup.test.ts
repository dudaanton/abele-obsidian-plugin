// @vitest-environment node
import { expect, it, vi, afterEach } from 'vitest'
import { TokenSyncLive } from '../e2e/helpers/tokenSyncLive'
vi.mock('../e2e/helpers/syncVault', () => ({ waitFor: vi.fn() }))
vi.mock('../e2e/helpers/syncServer', () => ({ siblingMissing: vi.fn(), fixtureFetch: vi.fn() }))
vi.mock('../e2e/helpers/obsidianCli', () => ({ vaultCli: vi.fn() }))
vi.mock('../e2e/helpers/phone', () => ({ PHONE_VAULT: 'phone', exposeToPhone: vi.fn() }))
vi.mock('../e2e/helpers/target', () => ({ onPhone: () => false }))
afterEach(() => vi.unstubAllEnvs())

it('attempts both pool resets and restores each pool even when the first reset fails', async () => {
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  vi.stubEnv('ABELE_SYNC_PEER_VAULT', 'peer-pool')
  const live = new TokenSyncLive()
  const devices = [live.primary, live.peer!]
  const resets = devices.map((device, index) =>
    vi.spyOn(device, 'resetTokenState').mockImplementation(async () => {
      if (index === 1) throw new Error('blocked')
    })
  )
  const forced = devices.map((device) =>
    vi.spyOn(device, 'forceResetTokenState').mockResolvedValue()
  )
  const removals = devices.map((device) => vi.spyOn(device, 'remove').mockImplementation(() => {}))
  const restorations = devices.map((device) => vi.spyOn(device, 'run').mockReturnValue(true))
  const saved = (
    live as unknown as {
      saved: Map<typeof live.primary, { ignore: string | null; file: string | null }>
    }
  ).saved
  for (const device of devices) saved.set(device, { ignore: 'existing ignore', file: null })
  await live.close()
  expect(forced[1]).toHaveBeenCalledOnce()
  expect(forced[0]).not.toHaveBeenCalled()
  for (let index = 0; index < devices.length; index++) {
    expect(resets[index]).toHaveBeenCalledOnce()
    expect(removals[index]).toHaveBeenCalledWith([live.root])
    expect(restorations[index].mock.calls.some(([body]) => body.includes('existing ignore'))).toBe(
      true
    )
    expect(
      restorations[index].mock.calls.some(([body]) => body.includes('__abeleSyncVisibility'))
    ).toBe(true)
  }
  await live.close()
  for (const reset of resets) expect(reset).toHaveBeenCalledOnce()
})

it('names discovered connections and pending paths without resetting pre-existing state', async () => {
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  const live = new TokenSyncLive(false)
  vi.spyOn(live.primary, 'rows').mockReturnValue([
    { id: 'existing-id', status: 'offline', address: 'https://sync.example', paused: false },
  ])
  vi.spyOn(live.primary, 'candidates').mockReturnValue([{ path: 'Scripts/pending.js' }] as never)
  vi.spyOn(live.primary, 'questions').mockReturnValue([])
  const reset = vi.spyOn(live.primary, 'resetTokenState')
  await expect(live.start()).rejects.toThrow('existing-id (offline)')
  await expect(live.start()).rejects.toThrow('Scripts/pending.js')
  expect(reset).not.toHaveBeenCalled()
})

it('reports both cleanup failures while still restoring the lease', async () => {
  vi.stubEnv('OBSIDIAN_TEST_VAULT', 'primary-pool')
  const live = new TokenSyncLive(false)
  vi.spyOn(live.primary, 'resetTokenState').mockRejectedValue(new Error('polite blocked'))
  vi.spyOn(live.primary, 'forceResetTokenState').mockRejectedValue(
    new Error('guarded recovery required')
  )
  const restore = vi.spyOn(live.primary, 'run').mockReturnValue(true)
  const remove = vi.spyOn(live.primary, 'remove').mockImplementation(() => {})
  const saved = (
    live as unknown as {
      saved: Map<typeof live.primary, { ignore: string | null; file: string | null }>
    }
  ).saved
  saved.set(live.primary, { ignore: 'original ignore', file: null })
  await expect(live.close()).rejects.toThrow('polite blocked; guarded recovery required')
  expect(remove).toHaveBeenCalledWith([live.root])
  expect(restore.mock.calls.some(([body]) => body.includes('original ignore'))).toBe(true)
})
